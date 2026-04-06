import type { RequestWithId } from '../../../infrastructure/http/interfaces/request-with-id.interface';
import type { AuthSessionContext } from '../domain/auth.types';
import type { SubscriptionAccessContext } from '../../subscriptions/domain/subscription-access.model';

export interface AuthenticatedRequest extends RequestWithId {
  auth?: AuthSessionContext;
  access?: SubscriptionAccessContext;
}
