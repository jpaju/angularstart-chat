import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Observable, Subject, defer, exhaustMap, merge } from 'rxjs';
import { collection, query, orderBy, limit, addDoc } from 'firebase/firestore';
import { collectionData } from 'rxfire/firestore';
import { filter, map, retry } from 'rxjs/operators';

import { FIRESTORE } from 'src/app/app.config';
import { Message } from '../interfaces/message';
import { AuthService } from './auth.service';
import { connect } from 'ngxtension/connect';

interface MessageState {
  messages: Message[];
  error: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class MessageService {
  private firestore = inject(FIRESTORE);
  private authService = inject(AuthService);
  private authUser$ = toObservable(this.authService.user);

  // sources
  messages$ = this.getMessages().pipe(
    // restart stream when user reauthenticates
    retry({
      delay: () => this.authUser$.pipe(filter((user) => !!user)),
    })
  );
  add$ = new Subject<Message['content']>();
  error$ = new Subject<string>();
  logout$ = this.authUser$.pipe(filter((user) => !user));

  // state
  private state = signal<MessageState>({
    messages: [],
    error: null,
  });

  // selectors
  messages = computed(() => this.state().messages);
  error = computed(() => this.state().error);

  constructor() {
    // reducers
    const nextMessages$ = merge(
      this.messages$.pipe(map((messages) => ({ messages }))),
      this.logout$.pipe(map(() => ({ messages: [] })))
    );

    const nextError$ = this.error$.pipe(map((error) => ({ error })));

    connect(this.state, merge(nextMessages$, nextError$));

    this.add$
      .pipe(
        takeUntilDestroyed(),
        exhaustMap((message) => this.addMessage(message))
      )
      .subscribe({
        error: (err) => {
          console.log(err);
          this.error$.next('Failed to send message');
        },
      });
  }

  private getMessages() {
    const messagesCollection = query(
      collection(this.firestore, 'messages'),
      orderBy('created', 'desc'),
      limit(50)
    );

    return collectionData(messagesCollection, { idField: 'id' }).pipe(
      map((messages) => [...messages].reverse())
    ) as Observable<Message[]>;
  }

  private addMessage(message: string) {
    const newMessage = {
      author: this.authService.user()?.email,
      content: message,
      created: Date.now().toString(),
    };

    const messagesCollection = collection(this.firestore, 'messages');
    return defer(() => addDoc(messagesCollection, newMessage));
  }
}
