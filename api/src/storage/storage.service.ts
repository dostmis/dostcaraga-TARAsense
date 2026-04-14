import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSignedUploadDto } from './dto/create-signed-upload.dto';
import { AuditService } from '../audit/audit.service';
import { Role } from '../common/enums/role.enum';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3?: S3Client;
  private readonly bucket: string;
  private storageReady = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {
    const endpoint = this.configService.get<string>('S3_ENDPOINT');
    const region = this.configService.get<string>('S3_REGION') || 'us-east-1';
    const accessKeyId = this.configService.get<string>('S3_ACCESS_KEY');
    const secretAccessKey = this.configService.get<string>('S3_SECRET_KEY');
    this.bucket = this.configService.get<string>('S3_BUCKET') || 'tarasense-files';

    if (!endpoint || !accessKeyId || !secretAccessKey) {
      this.logger.warn('S3 config is incomplete. Storage features are disabled until S3 is configured.');
      return;
    }

    this.s3 = new S3Client({
      endpoint,
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: String(this.configService.get<string>('S3_FORCE_PATH_STYLE') || 'true') === 'true',
    });
  }

  async onModuleInit() {
    if (!this.s3) {
      return;
    }

    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.storageReady = true;
    } catch {
      try {
        await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.storageReady = true;
      } catch (error) {
        const message = `Unable to initialize bucket ${this.bucket}: ${String(error)}`;
        if ((this.configService.get<string>('NODE_ENV') || 'development') === 'production') {
          throw new InternalServerErrorException(message);
        }
        this.logger.error(`${message}. Continuing without storage in non-production mode.`);
      }
    }
  }

  async uploadFile(
    file: Express.Multer.File,
    uploaderId?: string,
    meta?: { ip?: string; ua?: string | string[] },
  ) {
    const s3 = this.getS3Client();

    if (!file?.buffer?.length) {
      throw new BadRequestException('File is required');
    }

    const objectKey = this.buildObjectKey(file.originalname);

    const putResult = await s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: file.buffer,
        ContentType: file.mimetype || 'application/octet-stream',
      }),
    );

    const created = await this.prisma.storedFile.create({
      data: {
        uploaderId,
        bucket: this.bucket,
        objectKey,
        originalName: file.originalname,
        contentType: file.mimetype || 'application/octet-stream',
        size: file.size,
        etag: putResult.ETag?.replaceAll('"', '') || null,
      },
    });

    await this.auditService.log({
      action: 'FILE_UPLOAD',
      resource: 'stored_file',
      actorId: uploaderId,
      metadata: { fileId: created.id, objectKey: created.objectKey, size: created.size },
      ipAddress: meta?.ip,
      userAgent: meta?.ua,
    });

    return created;
  }

  async createSignedUpload(
    dto: CreateSignedUploadDto,
    uploaderId?: string,
    meta?: { ip?: string; ua?: string | string[] },
  ) {
    const s3 = this.getS3Client();
    const objectKey = this.buildObjectKey(dto.originalName);
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ContentType: dto.contentType,
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 60 * 10 });

    const created = await this.prisma.storedFile.create({
      data: {
        uploaderId,
        bucket: this.bucket,
        objectKey,
        originalName: dto.originalName,
        contentType: dto.contentType,
        size: dto.size || 0,
      },
    });

    await this.auditService.log({
      action: 'FILE_SIGNED_UPLOAD',
      resource: 'stored_file',
      actorId: uploaderId,
      metadata: { fileId: created.id, objectKey: created.objectKey },
      ipAddress: meta?.ip,
      userAgent: meta?.ua,
    });

    return {
      file: created,
      uploadUrl,
      method: 'PUT',
      headers: {
        'Content-Type': dto.contentType,
      },
    };
  }

  async getSignedDownloadUrl(fileId: string, requesterId: string, requesterRole: Role) {
    const s3 = this.getS3Client();

    const file = await this.prisma.storedFile.findFirst({
      where: requesterRole === Role.ADMIN ? { id: fileId } : { id: fileId, uploaderId: requesterId },
    });

    if (!file) {
      throw new BadRequestException('File not found');
    }
    if (requesterRole !== Role.ADMIN && file.uploaderId !== requesterId) {
      throw new ForbiddenException('You are not allowed to access this file');
    }

    const command = new GetObjectCommand({
      Bucket: file.bucket,
      Key: file.objectKey,
      ResponseContentType: file.contentType,
      ResponseContentDisposition: `inline; filename=\"${encodeURIComponent(file.originalName)}\"`,
    });

    const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 60 * 10 });

    return {
      file,
      downloadUrl,
    };
  }

  async listFiles(limit = 50, uploaderId?: string) {
    return this.prisma.storedFile.findMany({
      where: uploaderId ? { uploaderId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }

  private buildObjectKey(originalName: string) {
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const date = new Date().toISOString().slice(0, 10);
    return `uploads/${date}/${randomUUID()}-${safeName}`;
  }

  private getS3Client() {
    if (!this.s3 || !this.storageReady) {
      throw new ServiceUnavailableException(
        'Storage service is unavailable. Please ensure S3/MinIO is running and reachable.',
      );
    }

    return this.s3;
  }
}
