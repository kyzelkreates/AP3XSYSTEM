// AP3X Event Emitter — all actions must emit events

export function emitEvent(store, event) {
  const enriched = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    status: "pending",
    ...event
  };

  store.events.push(enriched);
  console.log(`[AP3X EVENT] ${enriched.type}`, enriched);
  return enriched;
}
