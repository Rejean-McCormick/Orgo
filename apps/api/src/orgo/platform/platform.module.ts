import { Global, Module } from '@nestjs/common';
import { Commands, Database } from './database';
@Global()
@Module({ providers: [Database, Commands], exports: [Database, Commands] })
export class PlatformModule {}
