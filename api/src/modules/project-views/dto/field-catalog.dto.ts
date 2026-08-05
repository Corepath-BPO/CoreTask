import { CUSTOM_FIELD_TYPES } from '@coretask/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class FieldCatalogQueryDto {
  @ApiPropertyOptional({
    description: 'Searches field types, system fields and custom fields together.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({
    description:
      'Comma-separated field references already visible in the view, e.g. `status,custom:<uuid>`. Matching entries are returned marked rather than omitted, so a search does not appear to lose them. One string rather than a repeated parameter because array serialisation differs between clients — axios sends `visible[]=`, which a strict validation pipe rejects outright.',
    example: 'title,status,custom:019fd2...',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  visible?: string;

  @ApiPropertyOptional({
    description: 'Pass `false` to skip the workspace library and return only this project’s fields.',
    enum: ['true', 'false'],
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  includeLibrary?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'], default: 'false' })
  @IsOptional()
  @IsIn(['true', 'false'])
  includeArchived?: string;
}

class FieldTypeDto {
  @ApiProperty({ enum: CUSTOM_FIELD_TYPES })
  type!: string;

  @ApiProperty({ example: 'Single-select' })
  label!: string;

  @ApiProperty({ example: 'Choose one coloured option' })
  description!: string;

  @ApiProperty({ description: 'Whether creating it requires a list of options first.' })
  hasOptions!: boolean;
}

class SystemFieldDto {
  @ApiProperty({ example: 'assigneeId' })
  key!: string;

  @ApiProperty({ example: 'Assignee' })
  label!: string;

  @ApiProperty({ example: 'Who is doing the work' })
  description!: string;

  @ApiProperty({ enum: CUSTOM_FIELD_TYPES, description: 'Decides the editor and the operators.' })
  dataType!: string;

  @ApiProperty()
  isSortable!: boolean;

  @ApiProperty()
  isFilterable!: boolean;

  @ApiProperty()
  isGroupable!: boolean;

  @ApiProperty({ description: 'False for anything the server derives.' })
  isEditable!: boolean;

  @ApiProperty({ description: 'Already a column in the view being edited.' })
  isInView!: boolean;
}

class CatalogOptionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({ example: 'amber' })
  colorToken!: string;
}

class CatalogFieldDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ enum: CUSTOM_FIELD_TYPES })
  type!: string;

  @ApiProperty({ type: [CatalogOptionDto], description: 'The first few options, for a preview.' })
  optionPreview!: CatalogOptionDto[];

  @ApiProperty({ description: 'How many projects in this workspace use it.' })
  usageCount!: number;

  @ApiProperty()
  isInProject!: boolean;

  @ApiProperty()
  isArchived!: boolean;
}

export class FieldCatalogDto {
  @ApiProperty({ type: [FieldTypeDto] })
  fieldTypes!: FieldTypeDto[];

  @ApiProperty({ type: [SystemFieldDto] })
  systemFields!: SystemFieldDto[];

  @ApiProperty({ type: [CatalogFieldDto], description: 'Attached to this project.' })
  projectFields!: CatalogFieldDto[];

  @ApiProperty({
    type: [CatalogFieldDto],
    description: 'In the workspace library but not yet used by this project.',
  })
  libraryFields!: CatalogFieldDto[];
}
