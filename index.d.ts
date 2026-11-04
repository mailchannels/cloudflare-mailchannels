import type { EmailsSendOptions, EmailsSendResponse, ErrorResponse, MailChannels, MetricsUsageResponse } from 'mailchannels-sdk'

export declare const DEFAULT_UPGRADE_URL: string
export declare const API_KEY_BINDING: 'MAILCHANNELS_API_KEY'

export interface MailChannelsOptions {
  /** Email API key. `fromEnv` reads it from the `MAILCHANNELS_API_KEY` secret. */
  apiKey?: string
  /** Email API base URL, for example the SDK simulator. */
  baseUrl?: string
  /** Where the account upgrades to a paid plan. */
  upgradeUrl?: string
  /** Request timeout in milliseconds. */
  timeout?: number | false
}

export interface LimitReachedError {
  type: 'limit_reached'
  message: string
  statusCode: number | null
  upgradeUrl: string
  usage: { total: number, monthlyLimit: number } | null
  response: Record<string, unknown> | null
  cause: ErrorResponse
}

export interface MissingApiKeyError {
  type: 'missing_api_key'
  message: string
  statusCode: null
  response: null
}

export type SendError = ErrorResponse | LimitReachedError | MissingApiKeyError

export interface SendResult {
  data: EmailsSendResponse['data']
  error: SendError | null
}

export interface MailChannelsSender {
  /** The SDK client, or null when no API key is configured. */
  client: MailChannels | null
  send(message: EmailsSendOptions, dryRun?: boolean): Promise<SendResult>
  usage(): Promise<MetricsUsageResponse | { data: null, error: MissingApiKeyError }>
  upgradeUrl: string
}

export interface MailChannelsEnv {
  MAILCHANNELS_API_KEY?: string
  MAILCHANNELS_BASE_URL?: string
  MAILCHANNELS_UPGRADE_URL?: string
}

export declare function createMailChannels(options?: MailChannelsOptions): MailChannelsSender
export declare function fromEnv(env?: MailChannelsEnv | Record<string, unknown>, options?: MailChannelsOptions): MailChannelsSender
export declare function isLimitError(error: unknown): error is LimitReachedError
