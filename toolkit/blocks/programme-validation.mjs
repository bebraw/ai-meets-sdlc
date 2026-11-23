export function validateProgramme(feed) {
  new Intl.DateTimeFormat("en", { timeZone: feed.event.timeZone });
  const ids = {};
  for (const key of ["speakers", "topics", "sessions", "actions"]) {
    ids[key] = new Set(feed[key].map((row) => row.id));
    if (ids[key].size !== feed[key].length)
      throw new Error("Duplicate " + key + " identifier");
  }
  for (const session of feed.sessions) {
    for (const id of session.speakerIds)
      if (!ids.speakers.has(id))
        throw new Error("Unknown speaker " + id + " in " + session.id);
    for (const id of session.topicIds)
      if (!ids.topics.has(id))
        throw new Error("Unknown topic " + id + " in " + session.id);
  }
  for (const item of [
    feed.event,
    ...feed.sessions,
    ...feed.speakers,
    ...feed.actions,
  ]) {
    if (
      item.startDate &&
      item.endDate &&
      Date.parse(item.endDate) < Date.parse(item.startDate)
    )
      throw new Error("End date precedes start date for " + item.id);
    if (!item.url) continue;
    const url = new URL(item.url);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error("Provide a public HTTPS URL.");
  }
}
