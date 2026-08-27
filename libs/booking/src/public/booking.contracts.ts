export interface ApprovedBookingSnapshot {
  bookingId: string;
  roomId: string;
  ownerId: string;
  renterId: string;
  viewingStartsAt: string;
  viewingEndsAt: string;
  approvedAt: string;
}

export type BookingStatus =
  'requested' | 'approved' | 'rejected' | 'cancelled' | 'expired' | 'consumed';

export abstract class BookingQueryService {
  public abstract getApprovedBookingSnapshot(
    bookingId: string,
  ): Promise<ApprovedBookingSnapshot | null>;
  public abstract getBookingStatus(bookingId: string): Promise<BookingStatus | null>;
}

export abstract class BookingPolicyService {
  public abstract assertBookingApproved(bookingId: string): Promise<void>;
  public abstract assertCanCreateContractFromBooking(bookingId: string): Promise<void>;
}

export abstract class BookingCommandService {
  public abstract markBookingConsumedByContract(
    bookingId: string,
    contractId: string,
  ): Promise<void>;
}
