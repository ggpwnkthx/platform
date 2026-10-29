/**
 * The ports of the CLI.
 *
 * The core of the CLI holds the commands and the policy of a command:
 * what it asks, what it accepts and what it refuses. It does not open a
 * socket, it does not read a file and it does not start a browser: those
 * are the ports of the platform, and the runtime is the place where the
 * concrete pieces are assembled.
 *
 * A port is a promise of a shape, and every implementation of it is
 * free to be another one: the tests of the CLI answer a port with a
 * double, and the deployment answers it with the network.
 */

/** The methods the CLI uses. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** A request of the CLI. */
export interface HttpRequest {
  /** The method of the request. */
  readonly method: HttpMethod
  /** The absolute address of the request. */
  readonly url: string
  /** The headers of the request. */
  readonly headers?: Readonly<Record<string, string>>
  /** The body of the request, when it carries one. */
  readonly body?: string
  /** The bearer token of the request, when it carries one. */
  readonly token?: string
}

/** The answer of a service. */
export interface HttpAnswer {
  /** The status of the answer. */
  readonly status: number
  /** The headers of the answer. */
  readonly headers: Readonly<Record<string, string>>
  /** The body of the answer, as it was received. */
  readonly body: string
}

/** The transport of the CLI. */
export interface HttpPort {
  /**
   * Sends a request and reads the answer.
   *
   * The port never throws for a refusal of a service: a refusal is an
   * answer with a status, and the caller decides what it means.
   */
  send(request: HttpRequest): Promise<HttpAnswer>
}

/** The store of the profiles of the deployments. */
export interface ProfileStorePort {
  /** Reads the profiles, or the empty ones when there is no file. */
  read(): Promise<Profiles>
  /** Writes the profiles. */
  write(profiles: Profiles): Promise<void>
}

/** The profiles of the deployments. */
export interface Profiles {
  /** The name of the profile the commands use when none is named. */
  readonly current?: string
  /** The profiles, by name. */
  readonly profiles: Readonly<Record<string, Profile>>
}

/** A profile of a deployment. */
export interface Profile {
  /** The address of the gateway, the door of the applications. */
  readonly gatewayUrl?: string
  /** The address of the control plane of the gateway. */
  readonly controlUrl?: string
  /** The address of Access. */
  readonly accessUrl?: string
  /** The workspace the commands of the data work on. */
  readonly workspaceId?: string
  /** The tenant the commands of the access work on. */
  readonly tenantId?: string
  /** The client the CLI signs in with. */
  readonly clientId?: string
  /** The secret of the client. */
  readonly clientSecret?: string
  /** The address the identity provider sends the caller back to. */
  readonly redirectUri?: string
}

/** A credential of the caller. */
export interface Credential {
  /** The bearer token of the caller. */
  readonly accessToken: string
  /** The moment the token stops being valid, in epoch milliseconds. */
  readonly expiresAt?: number
  /** The subject the token belongs to. */
  readonly subject?: string
}

/** The store of the credential of the caller. */
export interface CredentialStorePort {
  /** Reads the credential, or null when the caller is not signed in. */
  read(): Promise<Credential | null>
  /** Writes the credential. */
  write(credential: Credential): Promise<void>
  /** Removes the credential. */
  clear(): Promise<void>
}

/** The browser of the machine of the caller. */
export interface BrowserPort {
  /** Opens an address in the browser of the machine. */
  open(url: string): Promise<void>
}

/** The server that waits for the answer of the identity provider. */
export interface CallbackServer {
  /** The address the provider is asked to send the caller back to. */
  readonly redirectUri: string
  /** Waits for the code the provider sends back. */
  wait(): Promise<{ readonly code: string; readonly state: string }>
}

/** The server of the callback of the login. */
export interface CallbackPort {
  /** Starts a server that answers on the path of the callback. */
  start(options: {
    readonly host: string
    readonly port: number
    readonly path: string
  }): Promise<CallbackServer>
}

/** The randomness of the login. */
export interface CryptoPort {
  /** Bytes of the machine. */
  randomBytes(size: number): Uint8Array
  /** The digest of the bytes. */
  sha256(value: Uint8Array): Uint8Array
}
