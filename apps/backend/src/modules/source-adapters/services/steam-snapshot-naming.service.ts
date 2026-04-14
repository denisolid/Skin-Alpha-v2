import { Injectable } from '@nestjs/common';

import { ManagedMarketNamingService } from './managed-market-naming.service';

@Injectable()
export class SteamSnapshotNamingService extends ManagedMarketNamingService {}
