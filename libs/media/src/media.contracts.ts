import { ForbiddenException, NotFoundException } from '@nestjs/common';

export type ListingAssetSubject = 'property' | 'room';
export type ListingAssetStatus = 'pending' | 'ready' | 'quarantined' | 'deleted';
export interface ListingAsset {
  id: string;
  uploadedBy: string;
  subjectType: ListingAssetSubject;
  subjectId: string;
  provider: string;
  bucket: string;
  objectKey: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  status: ListingAssetStatus;
  published: boolean;
}
export abstract class ListingAssetRepository {
  public abstract create(asset: Omit<ListingAsset, 'id' | 'published'>): Promise<ListingAsset>;
  public abstract save(asset: ListingAsset): Promise<ListingAsset>;
  public abstract find(id: string): Promise<ListingAsset | null>;
  public abstract listPublished(
    subjectType: ListingAssetSubject,
    subjectId: string,
  ): Promise<readonly ListingAsset[]>;
}
/** Boundary implemented by Property; Media never reads Property tables/entities directly. */
export abstract class ListingAssetSubjectAuthorizer {
  public abstract assertOwns(
    ownerId: string,
    subjectType: ListingAssetSubject,
    subjectId: string,
  ): Promise<void>;
}
export abstract class ListingAssetStorage {
  public abstract createUploadTarget(input: {
    provider: string;
    bucket: string;
    objectKey: string;
    contentType: string;
  }): Promise<{ uploadUrl: string }>;
}
export class ListingAssetService {
  public constructor(
    private readonly assets: ListingAssetRepository,
    private readonly subjects: ListingAssetSubjectAuthorizer,
    private readonly storage: ListingAssetStorage,
  ) {}
  public async beginUpload(
    ownerId: string,
    asset: Omit<ListingAsset, 'id' | 'uploadedBy' | 'published' | 'status'>,
  ): Promise<ListingAsset & { uploadUrl: string }> {
    await this.subjects.assertOwns(ownerId, asset.subjectType, asset.subjectId);
    const saved = await this.assets.create({ ...asset, uploadedBy: ownerId, status: 'pending' });
    const target = await this.storage.createUploadTarget({
      provider: saved.provider,
      bucket: saved.bucket,
      objectKey: saved.objectKey,
      contentType: saved.contentType,
    });
    return { ...saved, ...target };
  }
  public async publish(ownerId: string, id: string): Promise<ListingAsset> {
    const asset = await this.owned(ownerId, id);
    if (asset.status !== 'ready')
      throw new ForbiddenException({
        code: 'ASSET_NOT_READY',
        message: 'Only ready assets may be published',
      });
    return this.assets.save({ ...asset, published: true });
  }
  public async privateAsset(ownerId: string, id: string): Promise<ListingAsset> {
    return this.owned(ownerId, id);
  }
  public listPublic(
    subjectType: ListingAssetSubject,
    subjectId: string,
  ): Promise<readonly ListingAsset[]> {
    return this.assets.listPublished(subjectType, subjectId);
  }
  private async owned(ownerId: string, id: string): Promise<ListingAsset> {
    const asset = await this.assets.find(id);
    if (!asset || asset.uploadedBy !== ownerId || asset.status === 'deleted')
      throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: 'Asset was not found' });
    await this.subjects.assertOwns(ownerId, asset.subjectType, asset.subjectId);
    return asset;
  }
}
