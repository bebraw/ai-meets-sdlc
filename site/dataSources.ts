import schedule from "./data/schedule.json" with { type: "json" };

function init() {
  return {
    scheduleItems: () => schedule.items,
  };
}

export { init };
