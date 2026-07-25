export const CommandsEnum = {
    FETCH: 'FETCH',
    SET_ID: 'SET_ID',
}
export type Commands = (typeof CommandsEnum)[keyof typeof CommandsEnum]
