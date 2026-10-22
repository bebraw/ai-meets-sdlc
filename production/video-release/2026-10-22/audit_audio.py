"""Audit available source channels and the final delivery audio without changing media."""
from pathlib import Path
import json,subprocess,hashlib
from datetime import datetime,timezone
import numpy as np
from scipy.signal import correlate,correlation_lags

R=Path('/Volumes/LaCie/SDLCAI/2026/post-production-2026-10-18')
S=R.parent
OUT=Path(__file__).resolve().parent
CACHE=OUT.parents[2]/'.cache/video-release-2026-10-22'
CACHE.mkdir(parents=True,exist_ok=True)
RATE=48000
def read(p):return json.loads(p.read_text())
def probe(p):
    return json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(p)],text=True))
def audio(p,start,seconds=10,channels=None,rate=RATE):
    # Preroll prevents AAC input-seek discard from masquerading as a source difference.
    before=max(0,start-4)
    args=['ffmpeg','-nostdin','-v','error','-ss',str(before),'-i',str(p),'-ss',str(start-before),'-t',str(seconds),'-map','0:a:0','-vn']
    if channels:args+=['-af','pan=stereo|c0=c0|c1=c1']
    args+=['-ar',str(rate),'-c:a','pcm_f32le','-f','f32le','pipe:1']
    data=subprocess.check_output(args)
    count=2 if channels else 8
    return np.frombuffer(data,dtype='<f4').reshape(-1,count)
def db(x):return round(float(20*np.log10(max(float(x),1e-12))),3)
def levels(a):
    return [{'channel':i,'rmsDbFS':db(np.sqrt(np.mean(c.astype(np.float64)**2))),'peakDbFS':db(np.max(np.abs(c))),'clippedSamples':int(np.sum(np.abs(c)>=.999))} for i,c in enumerate(a.T)]
def match(a,b,max_seconds=.04,rate=RATE):
    a=a.astype(np.float64);b=b.astype(np.float64)
    # Work at 8 kHz to compare alignment and shared content, not encoding artifacts.
    factor=rate//8000;a=a[::factor];b=b[::factor]
    a-=np.mean(a);b-=np.mean(b)
    limit=round(max_seconds*8000)
    corr=correlate(a,b,mode='full',method='fft');lags=correlation_lags(len(a),len(b),mode='full')
    selection=np.abs(lags)<=limit
    best=np.argmax(np.abs(corr[selection]));lag=int(lags[selection][best])
    if lag>0:a=a[lag:];b=b[:len(a)]
    elif lag<0:b=b[-lag:];a=a[:len(b)]
    length=min(len(a),len(b));a=a[:length];b=b[:length]
    coefficient=float(np.dot(a,b)/max(np.linalg.norm(a)*np.linalg.norm(b),1e-20))
    return {'lagSeconds':lag/8000,'correlation':round(coefficient,7)}
package=read(R/'metadata/upload-package-final-v09.json')
plan=read(R/'projects/talk-edit-v02.json')
index={x['id']:x for x in package['items']}
inventory=read(R/'inventory/source-recordings-v01.json')
sources=[]
for row in inventory['recordings']:
    p=S/row['relativePath'];pr=probe(p);a=next(x for x in pr['streams'] if x['codec_type']=='audio')
    sources.append({'path':str(p),'bytes':p.stat().st_size,'codec':a['codec_name'],'sampleRate':int(a['sample_rate']),'channels':a['channels'],'bitRate':int(a['bit_rate'])})
raw_pairs=[];deliveries=[]
split=plan['sourceSplitSeconds']
for item in plan['items']:
    ident=item['id'];duration=item['sourceEnd']-item['sourceStart']
    # Three separated positions per delivery, with channel comparisons across the day.
    points=[min(30,duration*.1),duration*.5,max(0,duration-30)]
    comparisons=[]
    for n,offset in enumerate(points):
        master=R/index[ident]['videoFile'];wav=Path(item['normalizedAudioPath'])
        output=offset+item['titleDurationSeconds']
        norm=audio(wav,output,8,channels=True)
        final=audio(master,output,8,channels=True)
        matched=match(norm.mean(axis=1),final.mean(axis=1))
        assert abs(matched['lagSeconds'])<=.001 and matched['correlation']>.99,(ident,matched)
        comparisons.append({'bodySeconds':offset,'outputSeconds':output,**matched})
        if n==1 or 'panel' in ident:
            global_time=item['sourceStart']+offset
            part=1 if global_time<split else 2
            local=global_time-(split if part==2 else 0)
            primary=S/'primary_camera'/('Ohjelma_alku.mp4' if part==1 else 'Ohjelma_loppu.mp4')
            secondary=S/'secondary_camera'/('Varakamera-moniraitaääni-alku.mp4' if part==1 else 'Varakamera-moniraitaääni-loppu.mp4')
            a=audio(primary,local,10)
            b=audio(secondary,local-3.2,10)
            row={'videoId':ident,'bodySeconds':offset,'primaryFile':str(primary),'primaryFileSeconds':local,'secondaryFile':str(secondary),'secondaryFileSeconds':local-3.2,'primaryChannels':levels(a),'secondaryChannels':levels(b),'backupChannelsAgainstProgramme':[]}
            reference=a[:,:2].mean(axis=1)
            for i in range(8):row['backupChannelsAgainstProgramme'].append({'channel':i,**match(reference,b[:,i])})
            row['programmeStereoCorrelation']=round(float(np.corrcoef(a[:,0],a[:,1])[0,1]),7)
            row['programmeMonoRmsDbFS']=db(np.sqrt(np.mean(reference.astype(np.float64)**2)))
            raw_pairs.append(row)
    pr=probe(R/index[ident]['videoFile']);a=next(x for x in pr['streams'] if x['codec_type']=='audio')
    wm=probe(Path(item['normalizedAudioPath']));wa=next(x for x in wm['streams'] if x['codec_type']=='audio')
    loudness=read(R/item['loudnessPath'])
    source_wav=Path(loudness['sourceAudio']);sp=probe(source_wav);sa=next(x for x in sp['streams'] if x['codec_type']=='audio')
    deliveries.append({'id':ident,'masterPath':index[ident]['videoFile'],'sourceExtraction':str(source_wav),'sourceExtractionCodec':sa['codec_name'],'sourceExtractionRate':int(sa['sample_rate']),'normalizedIntermediate':str(item['normalizedAudioPath']),'intermediateCodec':wa['codec_name'],'intermediateBits':wa.get('bits_per_raw_sample',wa.get('bits_per_sample')),'finalCodec':a['codec_name'],'finalProfile':a.get('profile'),'finalRate':int(a['sample_rate']),'finalChannels':a['channels'],'finalBitRate':int(a['bit_rate']),'normalization':loudness['settings'],'waveformChecks':comparisons})
    print('AUDITED',ident,flush=True)
    (CACHE/'audio-audit-progress.json').write_text(json.dumps({'deliveries':deliveries,'rawComparisons':raw_pairs},indent=2)+'\n')
mood=next(x for x in package['items'] if x['id']=='mood')
ma=next(x for x in probe(R/mood['videoFile'])['streams'] if x['codec_type']=='audio')
deliveries.append({'id':'mood','masterPath':mood['videoFile'],'finalCodec':ma['codec_name'],'finalProfile':ma.get('profile'),'finalRate':int(ma['sample_rate']),'finalChannels':ma['channels'],'finalBitRate':int(ma['bit_rate']),'source':'48 kHz, 24-bit final mix with lossless normalized music and voice stems.','audioIdentityEvidence':'exports/mood-qc-v07.json'})
report={'status':'measurements-complete-needs-source-selection-conclusion','createdAt':datetime.now(timezone.utc).isoformat(),'sources':sources,'deliveries':deliveries,'rawComparisons':raw_pairs,'scope':'Fresh technical channel, encoding, mono-compatibility and waveform checks. This is not a new subjective listening pass.','directListeningPerformed':False,'notes':['Source AAC bitrate covers eight channels; it must not be interpreted as stereo-only bitrate.','A PCM intermediate preserves decoded samples but does not recover information removed by the original AAC recording.','Correlation identifies shared content and alignment; it does not alone rank perceptual quality.'],'officialEncodingGuidance':'https://support.google.com/youtube/answer/1722171'}
(OUT/'audio-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print('AUDIO_AUDIT_MEASUREMENTS_COMPLETE',flush=True)
