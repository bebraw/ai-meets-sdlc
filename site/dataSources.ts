import schedule from "./data/schedule.json" with { type: "json" };
import seminarData from "./data/seminar.json" with { type: "json" };
import speakersData from "./data/speakers.json" with { type: "json" };

function init() {
  const speakersById = getSpeakersById();
  const scheduleItems = getScheduleItems(speakersById);
  const seminar = getSeminar();

  return {
    seminar: () => seminar,
    scheduleItems: () => scheduleItems,
    speakerItems: () =>
      scheduleItems.flatMap((item) =>
        (item.talks ?? []).flatMap((talk) =>
          talk.speakers.map((speaker) => {
            const speakerAnchor = getSpeakerAnchor(speaker.name);

            return {
              ...speaker,
              anchor: speakerAnchor,
              anchorHref: `#${speakerAnchor}`,
              speakerHref: `/speakers/#${speakerAnchor}`,
              sessionAnchor: item.anchor,
              scheduleHref: item.scheduleHref,
              sessionTitle: item.title,
              talk: {
                title: talk.title,
                abstract: talk.abstract,
              },
            };
          }),
        ),
      ),
  };
}

function getSeminar() {
  return {
    ...seminarData,
    display: {
      dateVenueLocation: `${seminarData.date.display} / ${seminarData.venue.name} / ${seminarData.location.display}`,
      dateShortVenueLocation: `${seminarData.date.display} / ${seminarData.venue.shortName} / ${seminarData.location.display}`,
      dateUniversityLocation: `${seminarData.date.display} / Aalto University / ${seminarData.location.display}`,
      footer: `${seminarData.name} / ${seminarData.date.display} / ${seminarData.venue.name} / sdlcai.org`,
    },
  };
}

function getScheduleItems(speakersById) {
  return schedule.items.map((item) => {
    const anchor = getSessionAnchor(item);
    const talks = item.talks?.map((talk) => {
      const talkSpeakers = talk.speakers.map((speakerId) => {
        const speaker = speakersById.get(speakerId);

        if (!speaker) {
          throw new Error(`Unknown speaker id: ${speakerId}`);
        }

        const speakerAnchor = getSpeakerAnchor(speaker.name);

        return {
          ...speaker,
          anchor: speakerAnchor,
          speakerHref: `/speakers/#${speakerAnchor}`,
        };
      });

      return {
        ...talk,
        speakers: talkSpeakers,
      };
    });

    return {
      ...item,
      talks,
      anchor,
      anchorHref: `#${anchor}`,
      scheduleHref: `/schedule/#${anchor}`,
    };
  });
}

function getSpeakersById() {
  return new Map(speakersData.items.map((speaker) => [speaker.id, speaker]));
}

function getSessionAnchor(item) {
  return `session-${item.time.slice(0, 5).replace(":", "")}-${slugify(
    item.title,
  )}`;
}

function getSpeakerAnchor(name) {
  return slugify(name);
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export { init };
