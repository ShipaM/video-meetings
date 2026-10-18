import { Query } from '@nestjs/cqrs';
import type { FileContent } from '../meeting-files.types.js';

/** Resolves a signed download link to the stored file, re-checking access in the database. */
export class GetFileContentQuery extends Query<FileContent> {
  constructor(
    public readonly fileId: string,
    public readonly token: string | undefined,
  ) {
    super();
  }
}
