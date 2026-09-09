import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService, JwtSignOptions, JwtVerifyOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';

import { User } from '../../backbone/user/user.entity';
import { EmailService } from '../../core/email/email.service';
import {
  NotificationService,
  NotificationChannel,
} from '../../core/notifications/notification.service';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthenticatedUser {
  id: string | number;
  email?: string | null;
  [key: string]: any;
}

export interface AuthResult {
  user: AuthenticatedUser;
  tokens: AuthTokens;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  private readonly accessTokenTtl: string | number;
  private readonly refreshTokenTtl: string | number;
  private readonly emailVerificationTtl: string | number;
  private readonly passwordResetTtl: string | number;
  private readonly passwordSaltRounds: number;
  private readonly frontendBaseUrl: string;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    @Optional()
    private readonly notificationService?: NotificationService,
  ) {
    this.accessTokenTtl =
      this.configService.get<string | number>('AUTH_ACCESS_TOKEN_TTL') ??
      '15m';
    this.refreshTokenTtl =
      this.configService.get<string | number>('AUTH_REFRESH_TOKEN_TTL') ??
      '7d';
    this.emailVerificationTtl =
      this.configService.get<string | number>('AUTH_EMAIL_VERIFICATION_TTL') ??
      '2d';
    this.passwordResetTtl =
      this.configService.get<string | number>('AUTH_PASSWORD_RESET_TTL') ??
      '1h';

    const saltConfig =
      this.configService.get<number>('AUTH_PASSWORD_SALT_ROUNDS') ??
      parseInt(process.env.AUTH_PASSWORD_SALT_ROUNDS || '', 10);
    this.passwordSaltRounds = Number.isFinite(saltConfig) && saltConfig > 0
      ? saltConfig
      : 12;

    this.frontendBaseUrl =
      this.configService.get<string>('APP_FRONTEND_BASE_URL') ??
      process.env.APP_FRONTEND_BASE_URL ??
      'http://localhost:3000';
  }

  /**
   * Login with email and password, returning the authenticated user and tokens.
   */
  async loginWithEmailAndPassword(
    email: string,
    password: string,
  ): Promise<AuthResult> {
    if (!email?.trim() || !password?.trim()) {
      throw new BadRequestException('Email and password are required.');
    }

    const user = await this.findUserByEmail(email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    await this.ensureUserIsActive(user);
    await this.verifyPassword(user, password);

    await this.markLastLogin(user);

    const tokens = await this.issueTokens(user);
    const safeUser = this.toSafeUser(user);

    return { user: safeUser, tokens };
  }

  /**
   * Register a new user with email and password.
   * Returns the newly created user and their tokens.
   * Optionally sends an email verification link.
   */
  async register(params: {
    email: string;
    password: string;
    metadata?: Record<string, any>;
  }): Promise<AuthResult> {
    const email = params.email?.trim().toLowerCase();
    const password = params.password?.trim();

    if (!email) {
      throw new BadRequestException('Email is required.');
    }

    if (!password) {
      throw new BadRequestException('Password is required.');
    }

    await this.ensureEmailIsAvailable(email);

    const passwordHash = await this.hashPassword(password);

    const user = this.userRepository.create({
      email,
      passwordHash,
      ...(params.metadata ?? {}),
    } as Partial<User>);

    const saved = await this.userRepository.save(user);

    // Fire-and-forget; do not block registration on email issues.
    this.sendVerificationEmailSafe(saved).catch((err) => {
      this.logger.warn(
        `Failed to send verification email for user "${saved.id}": ${err.message}`,
      );
    });

    const tokens = await this.issueTokens(saved);
    const safeUser = this.toSafeUser(saved);

    return { user: safeUser, tokens };
  }

  /**
   * Refreshes access and refresh tokens using a valid refresh token.
   */
  async refreshTokens(refreshToken: string): Promise<AuthResult> {
    if (!refreshToken?.trim()) {
      throw new BadRequestException('Refresh token is required.');
    }

    let payload: any;

    try {
      payload = await this.jwtService.verifyAsync(
        refreshToken,
        this.getJwtVerifyOptions(),
      );
    } catch (err) {
      this.logger.debug(`Invalid refresh token: ${(err as Error).message}`);
      throw new UnauthorizedException('Invalid refresh token.');
    }

    if (payload?.type !== 'refresh' || !payload?.sub) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new UnauthorizedException('User not found for this token.');
    }

    await this.ensureUserIsActive(user);

    const tokens = await this.issueTokens(user);
    const safeUser = this.toSafeUser(user);

    return { user: safeUser, tokens };
  }

  /**
   * Initiates a password reset by sending a reset email.
   * Does not reveal whether the email exists to avoid user enumeration.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const normalizedEmail = email?.trim().toLowerCase();
    if (!normalizedEmail) {
      throw new BadRequestException('Email is required.');
    }

    const user = await this.userRepository.findOne({
      where: { email: normalizedEmail },
    });

    if (!user) {
      // Do not reveal existence; log internally.
      this.logger.debug(
        `Password reset requested for non-existent email "${normalizedEmail}".`,
      );
      return;
    }

    const token = await this.jwtService.signAsync(
      {
        sub: user.id,
        email: user.email,
        purpose: 'reset-password',
      },
      {
        ...this.getJwtBaseOptions(),
        expiresIn: this.passwordResetTtl,
      },
    );

    const resetUrl = `${this.frontendBaseUrl}/auth/reset-password?token=${encodeURIComponent(
      token,
    )}`;

    await this.emailService.sendTemplate({
      to: user.email!,
      template: 'auth.password-reset',
      context: {
        userId: user.id,
        email: user.email,
        token,
        url: resetUrl,
      },
    });
  }

  /**
   * Resets a user's password using a previously issued reset token.
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (!token?.trim()) {
      throw new BadRequestException('Reset token is required.');
    }

    if (!newPassword?.trim()) {
      throw new BadRequestException('New password is required.');
    }

    let payload: any;

    try {
      payload = await this.jwtService.verifyAsync(
        token,
        this.getJwtVerifyOptions(),
      );
    } catch (err) {
      this.logger.debug(`Invalid reset token: ${(err as Error).message}`);
      throw new BadRequestException('Invalid or expired reset token.');
    }

    if (payload?.purpose !== 'reset-password' || !payload?.sub) {
      throw new BadRequestException('Invalid reset token.');
    }

    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new BadRequestException('Invalid reset token.');
    }

    await this.ensureUserIsActive(user);

    const passwordHash = await this.hashPassword(newPassword);
    user.passwordHash = passwordHash as any;

    await this.userRepository.save(user);

    // Optional security notification
    this.notificationService
      ?.notify({
        userId: String(user.id),
        type: 'auth.password-changed',
        channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
        title: 'Your password was changed',
        body: 'If you did not perform this change, please contact support immediately.',
        data: { userId: user.id },
        email: user.email
          ? {
              to: user.email,
              subject: 'Your password was changed',
              template: 'auth.password-changed',
              context: {
                userId: user.id,
                email: user.email,
              },
            }
          : undefined,
      })
      .catch((err) => {
        this.logger.warn(
          `Failed to send password-changed notification for user "${user.id}": ${err.message}`,
        );
      });
  }

  /**
   * Sends an email verification link to a user.
   */
  async sendVerificationEmail(userId: string | number): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('User not found.');
    }

    await this.sendVerificationEmailSafe(user);
  }

  /**
   * Verifies a user's email using a verification token.
   */
  async verifyEmail(token: string): Promise<void> {
    if (!token?.trim()) {
      throw new BadRequestException('Verification token is required.');
    }

    let payload: any;

    try {
      payload = await this.jwtService.verifyAsync(
        token,
        this.getJwtVerifyOptions(),
      );
    } catch (err) {
      this.logger.debug(`Invalid verification token: ${(err as Error).message}`);
      throw new BadRequestException('Invalid or expired verification token.');
    }

    if (payload?.purpose !== 'verify-email' || !payload?.sub) {
      throw new BadRequestException('Invalid verification token.');
    }

    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new BadRequestException('Invalid verification token.');
    }

    await this.ensureUserIsActive(user);

    // If already verified, do nothing.
    if ((user as any).isEmailVerified === true) {
      return;
    }

    (user as any).isEmailVerified = true;
    await this.userRepository.save(user);
  }

  /**
   * Validates credentials and returns the user if valid. Throws otherwise.
   * This is suitable for use by Passport strategies.
   */
  async validateUser(
    email: string,
    password: string,
  ): Promise<AuthenticatedUser> {
    const result = await this.loginWithEmailAndPassword(email, password);
    return result.user;
  }

  /**
   * Ensures the user is active (not disabled/locked).
   * Adjust this to match your actual user status fields.
   */
  private async ensureUserIsActive(user: User): Promise<void> {
    const status = (user as any).status;
    if (status && status !== 'active') {
      throw new ForbiddenException('User account is not active.');
    }
  }

  private async findUserByEmail(email: string): Promise<User | null> {
    const normalized = email.trim().toLowerCase();
    return this.userRepository.findOne({ where: { email: normalized } });
  }

  private async ensureEmailIsAvailable(email: string): Promise<void> {
    const existing = await this.userRepository.findOne({
      where: { email },
    });

    if (existing) {
      throw new BadRequestException('Email is already in use.');
    }
  }

  private async verifyPassword(user: User, password: string): Promise<void> {
    const hash = (user as any).passwordHash;
    if (!hash) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const match = await bcrypt.compare(password, hash);
    if (!match) {
      throw new UnauthorizedException('Invalid credentials.');
    }
  }

  private async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.passwordSaltRounds);
  }

  private async markLastLogin(user: User): Promise<void> {
    if (!('lastLoginAt' in user)) {
      return;
    }

    (user as any).lastLoginAt = new Date();
    await this.userRepository.save(user);
  }

  private async issueTokens(user: User): Promise<AuthTokens> {
    const payloadBase = {
      sub: user.id,
      email: (user as any).email,
    };

    const accessToken = await this.jwtService.signAsync(
      {
        ...payloadBase,
        type: 'access',
      },
      {
        ...this.getJwtBaseOptions(),
        expiresIn: this.accessTokenTtl,
      },
    );

    const refreshToken = await this.jwtService.signAsync(
      {
        ...payloadBase,
        type: 'refresh',
      },
      {
        ...this.getJwtBaseOptions(),
        expiresIn: this.refreshTokenTtl,
      },
    );

    return { accessToken, refreshToken };
  }

  private toSafeUser(user: User): AuthenticatedUser {
    const { passwordHash, ...rest } = user as any;
    return rest as AuthenticatedUser;
  }

  private getJwtBaseOptions(): JwtSignOptions {
    const issuer =
      this.configService.get<string>('AUTH_JWT_ISSUER') ??
      process.env.AUTH_JWT_ISSUER;
    const audience =
      this.configService.get<string>('AUTH_JWT_AUDIENCE') ??
      process.env.AUTH_JWT_AUDIENCE;

    const options: JwtSignOptions = {};
    if (issuer) {
      options.issuer = issuer;
    }
    if (audience) {
      options.audience = audience;
    }
    return options;
  }

  private getJwtVerifyOptions(): JwtVerifyOptions {
    const base = this.getJwtBaseOptions();
    const options: JwtVerifyOptions = {
      issuer: base.issuer,
      audience: base.audience,
    };
    return options;
  }

  private async sendVerificationEmailSafe(user: User): Promise<void> {
    const email = (user as any).email;
    if (!email) {
      return;
    }

    const token = await this.jwtService.signAsync(
      {
        sub: user.id,
        email,
        purpose: 'verify-email',
      },
      {
        ...this.getJwtBaseOptions(),
        expiresIn: this.emailVerificationTtl,
      },
    );

    const verifyUrl = `${this.frontendBaseUrl}/auth/verify-email?token=${encodeURIComponent(
      token,
    )}`;

    await this.emailService.sendTemplate({
      to: email,
      template: 'auth.verify-email',
      context: {
        userId: user.id,
        email,
        token,
        url: verifyUrl,
      },
    });
  }
}
