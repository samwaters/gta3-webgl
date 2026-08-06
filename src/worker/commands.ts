export const CommandsEnum = {
  CHECK: "CHECK",
  EXTRACT: "EXTRACT",
  FETCH: "FETCH",
  SET_ID: "SET_ID",
}
export type Commands = (typeof CommandsEnum)[keyof typeof CommandsEnum]
