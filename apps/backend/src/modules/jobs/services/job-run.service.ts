import { JobRunStatus, JobType, type Prisma } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';

import { AppLoggerService } from '../../../infrastructure/logging/app-logger.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

interface QueueJobRunInput {
  readonly queueName: string;
  readonly jobType: JobType;
  readonly jobName: string;
  readonly externalJobId?: string;
  readonly payload?: Prisma.InputJsonValue;
}

interface CompleteJobRunInput {
  readonly jobRunId: string;
  readonly result?: Prisma.InputJsonValue;
}

interface FailJobRunInput extends CompleteJobRunInput {
  readonly errorMessage: string;
}

@Injectable()
export class JobRunService {
  constructor(
    @Inject(AppLoggerService)
    private readonly logger: AppLoggerService,
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
  ) {}

  async ensureQueuedJobRun(input: QueueJobRunInput): Promise<string> {
    if (input.externalJobId) {
      const existingJobRun = await this.prismaService.jobRun.findFirst({
        where: {
          queueName: input.queueName,
          jobName: input.jobName,
          externalJobId: input.externalJobId,
          finishedAt: null,
        },
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          id: true,
        },
      });

      if (existingJobRun) {
        this.logger.debug(
          `Reused queued maintenance job run ${existingJobRun.id} for ${input.queueName}.`,
          JobRunService.name,
        );

        return existingJobRun.id;
      }
    }

    const jobRun = await this.prismaService.jobRun.create({
      data: {
        queueName: input.queueName,
        jobType: input.jobType,
        jobName: input.jobName,
        status: JobRunStatus.QUEUED,
        ...(input.externalJobId ? { externalJobId: input.externalJobId } : {}),
        ...(input.payload ? { payload: input.payload } : {}),
      },
    });

    this.logger.log(
      `Queued maintenance job run ${jobRun.id} for ${input.queueName}${input.externalJobId ? ` (${input.externalJobId})` : ''}.`,
      JobRunService.name,
    );

    return jobRun.id;
  }

  async startQueuedJobRun(input: QueueJobRunInput): Promise<string> {
    const existingJobRun = input.externalJobId
      ? await this.prismaService.jobRun.findFirst({
          where: {
            queueName: input.queueName,
            jobName: input.jobName,
            externalJobId: input.externalJobId,
            finishedAt: null,
          },
          orderBy: {
            createdAt: 'desc',
          },
          select: {
            id: true,
            status: true,
          },
        })
      : null;

    if (!existingJobRun) {
      return this.startJobRun(input);
    }

    if (existingJobRun.status !== JobRunStatus.RUNNING) {
      await this.prismaService.jobRun.update({
        where: {
          id: existingJobRun.id,
        },
        data: {
          status: JobRunStatus.RUNNING,
          startedAt: new Date(),
          ...(input.payload ? { payload: input.payload } : {}),
        },
      });
      this.logger.log(
        `Promoted queued maintenance job run ${existingJobRun.id} to RUNNING for ${input.queueName}.`,
        JobRunService.name,
      );
    }

    return existingJobRun.id;
  }

  async startJobRun(input: QueueJobRunInput): Promise<string> {
    const jobRun = await this.prismaService.jobRun.create({
      data: {
        queueName: input.queueName,
        jobType: input.jobType,
        jobName: input.jobName,
        status: JobRunStatus.RUNNING,
        startedAt: new Date(),
        ...(input.externalJobId ? { externalJobId: input.externalJobId } : {}),
        ...(input.payload ? { payload: input.payload } : {}),
      },
    });

    this.logger.log(
      `Started maintenance job run ${jobRun.id} for ${input.queueName}.`,
      JobRunService.name,
    );

    return jobRun.id;
  }

  async completeJobRun(input: CompleteJobRunInput): Promise<void> {
    await this.prismaService.jobRun.update({
      where: {
        id: input.jobRunId,
      },
      data: {
        status: JobRunStatus.SUCCEEDED,
        finishedAt: new Date(),
        ...(input.result ? { result: input.result } : {}),
      },
    });
    this.logger.log(
      `Completed maintenance job run ${input.jobRunId}.`,
      JobRunService.name,
    );
  }

  async failJobRun(input: FailJobRunInput): Promise<void> {
    await this.prismaService.jobRun.update({
      where: {
        id: input.jobRunId,
      },
      data: {
        status: JobRunStatus.FAILED,
        errorMessage: input.errorMessage,
        finishedAt: new Date(),
        ...(input.result ? { result: input.result } : {}),
      },
    });
    this.logger.error(
      `Failed maintenance job run ${input.jobRunId}: ${input.errorMessage}`,
      undefined,
      JobRunService.name,
    );
  }

  async cancelJobRun(input: CompleteJobRunInput): Promise<void> {
    await this.prismaService.jobRun.update({
      where: {
        id: input.jobRunId,
      },
      data: {
        status: JobRunStatus.CANCELED,
        finishedAt: new Date(),
        ...(input.result ? { result: input.result } : {}),
      },
    });
    this.logger.warn(
      `Canceled maintenance job run ${input.jobRunId}.`,
      JobRunService.name,
    );
  }

  async hasActiveJob(queueName: string): Promise<boolean> {
    const activeJob = await this.prismaService.jobRun.findFirst({
      where: {
        queueName,
        status: {
          in: [JobRunStatus.QUEUED, JobRunStatus.RUNNING],
        },
        finishedAt: null,
      },
      select: {
        id: true,
      },
    });

    return Boolean(activeJob);
  }

  async getLatestSuccessfulJob(queueName: string): Promise<{
    readonly id: string;
    readonly finishedAt: Date;
  } | null> {
    return this.prismaService.jobRun.findFirst({
      where: {
        queueName,
        status: JobRunStatus.SUCCEEDED,
        finishedAt: {
          not: null,
        },
      },
      orderBy: {
        finishedAt: 'desc',
      },
      select: {
        id: true,
        finishedAt: true,
      },
    }) as Promise<{
      readonly id: string;
      readonly finishedAt: Date;
    } | null>;
  }
}
