import { Transform } from 'class-transformer';
import { Equals, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  // The limit applies to the trimmed name; an empty one clears it (UpdateProfileCommand).
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(50)
  name?: string | null;

  // A completed avatar upload of the caller (the tus upload id) to show on the profile.
  @IsOptional()
  @IsUUID()
  avatarUploadId?: string;

  // Only `null` is accepted: it removes the avatar.
  @IsOptional()
  @Equals(null)
  avatar?: null;
}
