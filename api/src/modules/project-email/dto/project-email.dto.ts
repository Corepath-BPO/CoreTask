import { INBOUND_EMAIL_SENDERS, type InboundEmailSender } from '@coretask/contracts';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsUUID, ValidateIf } from 'class-validator';

export class UpdateProjectEmailDto {
  @ApiPropertyOptional({ description: 'Off, mail to the address is dropped.' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ nullable: true, description: "The project's first section when null." })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  sectionId?: string | null;

  @ApiPropertyOptional({ enum: INBOUND_EMAIL_SENDERS })
  @IsOptional()
  @IsIn(INBOUND_EMAIL_SENDERS)
  acceptFrom?: InboundEmailSender;

  @ApiPropertyOptional({ description: 'Members on To and CC become collaborators.' })
  @IsOptional()
  @IsBoolean()
  addCollaborators?: boolean;

  @ApiPropertyOptional({ description: 'Outside addresses on the email hear about comments.' })
  @IsOptional()
  @IsBoolean()
  sendUpdates?: boolean;
}
