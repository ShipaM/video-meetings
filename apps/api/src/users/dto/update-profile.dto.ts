import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  // The limit applies to the trimmed name; an empty one clears it (UpdateProfileCommand).
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(50)
  name?: string | null;
}
