declare module 'd3-force-3d' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Any = any;
  export function forceSimulation(nodos: Any[], dimensiones?: number): Any;
  export function forceLink(enlaces: Any[]): Any;
  export function forceManyBody(): Any;
}
