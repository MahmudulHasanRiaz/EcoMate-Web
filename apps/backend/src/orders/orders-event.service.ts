import { Injectable } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';

export interface OrderEvent {
  type: 'order.created' | 'order.status_changed' | 'order.trashed' | 'order.restored';
  data: any;
}

@Injectable()
export class OrdersEventService {
  private events = new Subject<OrderEvent>();

  emit(event: OrderEvent) {
    this.events.next(event);
  }

  subscribe(): Observable<OrderEvent> {
    return this.events.asObservable();
  }
}
