import { ApiProperty } from '@nestjs/swagger';

import { CustomFieldDto } from '../../custom-fields/dto/custom-field-response.dto';

class MetadataStatusDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'In Progress' })
  name!: string;

  @ApiProperty({ example: 'ACTIVE' })
  category!: string;

  @ApiProperty({ example: 'blue' })
  colorToken!: string;
}

class MetadataPriorityDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'High' })
  name!: string;

  @ApiProperty({ example: 3 })
  level!: number;

  @ApiProperty({ example: 'orange' })
  colorToken!: string;
}

class MetadataSectionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'In progress' })
  name!: string;
}

class MetadataMemberDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Demo Owner' })
  name!: string;

  @ApiProperty({ example: 'demo@coretask.dev' })
  email!: string;

  @ApiProperty({ nullable: true, example: null })
  avatarUrl!: string | null;
}

/** Everything a Fields menu or filter builder needs, in one response. */
export class ProjectFieldMetadataDto {
  @ApiProperty({ type: [CustomFieldDto] })
  customFields!: CustomFieldDto[];

  @ApiProperty({ type: [MetadataStatusDto] })
  statuses!: MetadataStatusDto[];

  @ApiProperty({ type: [MetadataPriorityDto] })
  priorities!: MetadataPriorityDto[];

  @ApiProperty({ type: [MetadataSectionDto] })
  sections!: MetadataSectionDto[];

  @ApiProperty({ type: [MetadataMemberDto] })
  members!: MetadataMemberDto[];
}
