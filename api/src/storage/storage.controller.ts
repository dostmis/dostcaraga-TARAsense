import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Ip,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Request } from 'express';
import { StorageService } from './storage.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateSignedUploadDto } from './dto/create-signed-upload.dto';

@Controller('files')
@UseGuards(JwtAuthGuard)
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Post('upload')
  @Roles(Role.ADMIN, Role.MSME, Role.FIC)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        fileSize: 20 * 1024 * 1024,
      },
    }),
  )
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { sub: string },
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    const created = await this.storageService.uploadFile(file, user.sub, {
      ip,
      ua: request.headers['user-agent'],
    });

    return { file: created };
  }

  @Post('signed-upload')
  @Roles(Role.ADMIN, Role.MSME, Role.FIC)
  async signedUpload(
    @Body() dto: CreateSignedUploadDto,
    @CurrentUser() user: { sub: string },
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.storageService.createSignedUpload(dto, user.sub, {
      ip,
      ua: request.headers['user-agent'],
    });
  }

  @Get()
  @Roles(Role.ADMIN, Role.MSME, Role.FIC)
  async listFiles(
    @CurrentUser() user: { sub: string; role: Role },
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    const uploaderId = user.role === Role.ADMIN ? undefined : user.sub;
    const files = await this.storageService.listFiles(limit, uploaderId);
    return { files };
  }

  @Get(':fileId/signed-download')
  @Roles(Role.ADMIN, Role.MSME, Role.FIC)
  async signedDownload(
    @Param('fileId') fileId: string,
    @CurrentUser() user: { sub: string; role: Role },
  ) {
    const result = await this.storageService.getSignedDownloadUrl(fileId, user.sub, user.role);
    return {
      downloadUrl: result.downloadUrl,
    };
  }
}
