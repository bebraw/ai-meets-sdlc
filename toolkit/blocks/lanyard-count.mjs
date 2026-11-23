export function lanyardsCount({ people, spares = [], colors = [] }) {
  const roles = new Map();
  function entry(role) {
    if (!roles.has(role))
      roles.set(role, { role, named: 0, spares: 0, total: 0 });
    return roles.get(role);
  }
  for (const item of colors) entry(item.role);
  for (const p of people) if (p.included !== false) entry(p.role).named++;
  for (const p of spares) entry(p.role).spares += p.count;
  const roleColors = new Map(colors.map((r) => [r.role, r.color]));
  const byColor = new Map();
  for (const row of roles.values()) {
    row.total = row.named + row.spares;
    row.color = roleColors.get(row.role) ?? row.role;
    byColor.set(row.color, (byColor.get(row.color) ?? 0) + row.total);
  }
  return {
    roles: [...roles.values()],
    byColor: Object.fromEntries(byColor),
    total: [...byColor.values()].reduce((a, b) => a + b, 0),
  };
}
