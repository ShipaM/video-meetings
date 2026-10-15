import { IsDateString, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateMeetingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsDateString()
  startsAt: string;
}
