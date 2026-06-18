import schedule from "./data/schedule.json" with { type: "json" };

function init() {
  const scheduleItems = getScheduleItems();

  return {
    scheduleItems: () => scheduleItems,
    speakerItems: () =>
      scheduleItems
        .filter((item) => item.speaker && item.talk)
        .map((item) => ({
          ...item.speaker,
          anchor: item.anchor,
          scheduleHref: item.scheduleHref,
          time: item.time,
          sessionTitle: item.title,
          talk: item.talk,
        })),
  };
}

function getScheduleItems() {
  return schedule.items.map((item) => {
    const anchor = getSessionAnchor(item);

    return {
      ...item,
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

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export { init };
