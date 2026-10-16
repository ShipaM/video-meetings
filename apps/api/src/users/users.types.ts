/** A stored user. Includes `passwordHash`, so it is for internal (CQRS) use only, never for HTTP responses. */
export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
}
