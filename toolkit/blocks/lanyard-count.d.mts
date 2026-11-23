export function lanyardsCount<Role extends string>(input: {
  people: readonly { role: Role; included?: boolean }[];
  spares?: readonly { role: Role; count: number }[];
  colors?: readonly { role: Role; color: string }[];
}): {
  roles: {
    role: Role;
    named: number;
    spares: number;
    total: number;
    color: string;
  }[];
  byColor: Record<string, number>;
  total: number;
};
