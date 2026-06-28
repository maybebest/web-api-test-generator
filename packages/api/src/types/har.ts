import type { JsonValue } from './json.js';

export interface HarNameValue {
  name: string;
  value: string;
}

export interface HarPostData {
  mimeType?: string;
  text?: string;
  params?: HarNameValue[];
}

export interface HarRequest {
  method: string;
  url: string;
  httpVersion?: string;
  headers?: HarNameValue[];
  queryString?: HarNameValue[];
  postData?: HarPostData;
}

export interface HarResponseContent {
  size?: number;
  mimeType?: string;
  text?: string;
  encoding?: string;
}

export interface HarResponse {
  status: number;
  statusText?: string;
  headers?: HarNameValue[];
  content?: HarResponseContent;
}

export interface HarEntry {
  startedDateTime?: string;
  time?: number;
  request: HarRequest;
  response: HarResponse;
}

export interface HarFile {
  log: {
    version?: string;
    creator?: {
      name?: string;
      version?: string;
    };
    entries: HarEntry[];
  };
}

export interface ParsedHarEntry {
  sourceFile: string;
  entryIndex: number;
  startedDateTime?: string;
  timeMs: number;
  request: HarRequest;
  response: HarResponse;
}

export interface NormalizedHarEntry {
  id: string;
  sourceFile: string;
  entryIndex: number;
  method: HttpMethod;
  originalUrl: string;
  defaultBaseUrl: string;
  hostname: string;
  path: string;
  pathPattern: string;
  pathWithQuery: string;
  query: Record<string, string>;
  requestHeaders: Record<string, string>;
  requestBody?: JsonValue | string;
  requestMimeType?: string;
  responseStatus: number;
  responseHeaders: Record<string, string>;
  responseContentType?: string;
  responseBody?: JsonValue;
  responseTimeMs: number;
  groupName: string;
  testName: string;
  fixtureName?: string;
  schemaName?: string;
  dynamicSegments: string[];
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export const supportedHttpMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type SupportedHttpMethod = (typeof supportedHttpMethods)[number];
