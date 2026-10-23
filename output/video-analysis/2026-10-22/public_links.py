"""Attach published video URLs without requiring the external media drive."""
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
RELEASE = HERE.parents[2] / 'production/video-release/2026-10-22/release.json'


def youtube_url(video_id, start=0):
    url = f'https://www.youtube.com/watch?v={video_id}'
    return f'{url}&t={math.floor(start)}s' if start else url


def add_public_links(library):
    release = json.loads(RELEASE.read_text())
    videos = {item['id']: item for item in release['items']}
    for item in library['items']:
        published = videos[item['id']]
        item['youtubeId'] = published['youtubeId']
        item['youtubeUrl'] = youtube_url(published['youtubeId'])
        for key, start_key in [('chapters', 'outputSeconds'), ('takeaways', 'start'),
                               ('quoteCandidates', 'start'), ('clipCandidates', 'start')]:
            for entry in item[key]:
                start = entry[start_key]
                assert 0 <= start < item['durationSeconds']
                entry['youtubeUrl'] = youtube_url(published['youtubeId'], start)
                if 'originalContext' in entry:
                    original = entry['originalContext']
                    original['youtubeUrl'] = youtube_url(videos[original['videoId']]['youtubeId'], original['start'])
    for section in ['themes', 'tensions']:
        for entry in library['synthesis'][section]:
            for evidence in entry['evidence']:
                evidence['youtubeUrl'] = youtube_url(videos[evidence['videoId']]['youtubeId'], evidence['start'])
    library['publicLinks'] = {
        'linkedOn': '2026-10-23', 'videoCount': len(videos),
        'timebase': 'Final edited videos, including title cards. Start times are rounded down to whole seconds.',
        'playlistUrl': release['playlist']['url'],
    }
    library['synthesis']['reusePlan'][0]['nextStep'] = 'Published YouTube links and timestamp links are available for all sessions, takeaways, quotation candidates and clip candidates.'
    return library


if __name__ == '__main__':
    from assemble_library import make_page
    path = HERE / 'content-library.json'
    library = add_public_links(json.loads(path.read_text()))
    path.write_text(json.dumps(library, ensure_ascii=False, indent=2) + '\n')
    make_page(library)
    print(f"Linked {len(library['items'])} published videos and regenerated the Page companion.")
