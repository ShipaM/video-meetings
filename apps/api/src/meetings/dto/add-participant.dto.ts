import { IsEmail } from 'class-validator';

export class AddParticipantDto {
  @IsEmail()
  email: string;
}
