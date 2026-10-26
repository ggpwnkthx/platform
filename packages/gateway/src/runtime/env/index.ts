/**
 * The environment of the gateway.
 *
 * The module is one thing to the rest of the project: the settings of the
 * gateway and the reading of the environment. Its three files hold the
 * shape of the settings, the names of the variables and the reading of
 * them.
 */
export * from './read'
export * from './schema'
export * from './settings'
