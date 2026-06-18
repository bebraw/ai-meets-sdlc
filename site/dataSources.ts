import schedule from "./data/schedule.json" with { type: "json" };

function init() {
  const scheduleItems = getScheduleItems();

  return {
    scheduleItems: () => scheduleItems,
    speakerItems: () =>
      scheduleItems.flatMap((item) =>
        (item.talks ?? []).map((talk) => {
          const speakerAnchor = getSpeakerAnchor(talk.speaker.name);

          return {
            ...talk.speaker,
            anchor: speakerAnchor,
            anchorHref: `#${speakerAnchor}`,
            speakerHref: `/speakers/#${speakerAnchor}`,
            sessionAnchor: item.anchor,
            scheduleHref: item.scheduleHref,
            time: talk.time,
            sessionTitle: item.title,
            talk: {
              title: talk.title,
              abstract: talk.abstract,
            },
          };
        }),
      ),
  };
}

function getScheduleItems() {
  return schedule.items.map((item) => {
    const anchor = getSessionAnchor(item);
    const talks = item.talks?.map((talk) => {
      const speakerAnchor = getSpeakerAnchor(talk.speaker.name);

      return {
        ...talk,
        speaker: {
          ...talk.speaker,
          anchor: speakerAnchor,
          speakerHref: `/speakers/#${speakerAnchor}`,
        },
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
