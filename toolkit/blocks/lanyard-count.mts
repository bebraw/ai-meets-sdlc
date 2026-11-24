export interface LanyardRow<Role extends string> {
  role: Role;
  named: number;
  spares: number;
  total: number;
  color: string;
}
export function lanyardsCount<Role extends string>({
  people,
  spares = [],
  colors = [],
}: {
  people: readonly { role: Role; included?: boolean }[];
  spares?: readonly { role: Role; count: number }[];
  colors?: readonly { role: Role; color: string }[];
}) {
  const roles = new Map<Role, LanyardRow<Role>>();
  function entry(role: Role) {
    const existing = roles.get(role);
    if (existing) return existing;
    const row = { role, named: 0, spares: 0, total: 0, color: role as string };
    roles.set(role, row);
    return row;
  }
  for (const item of colors) entry(item.role);
  for (const p of people) if (p.included !== false) entry(p.role).named++;
  for (const p of spares) entry(p.role).spares += p.count;
  const roleColors = new Map(colors.map((r) => [r.role, r.color]));
  const byColor = new Map<string, number>();
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
