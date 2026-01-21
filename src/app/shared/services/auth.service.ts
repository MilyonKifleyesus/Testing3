import { Injectable,NgZone } from '@angular/core';
import { AngularFireModule } from '@angular/fire/compat';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AngularFirestoreDocument } from '@angular/fire/compat/firestore';
import { BehaviorSubject, Observable } from 'rxjs';

export interface User {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  emailVerified: boolean;
  role?: 'superadmin' | 'admin' | 'inspector' | 'client';
}
@Injectable({
  providedIn: 'root',
})
export class AuthService {
  authState: any;
  afAuth: any;
  afs: any;
  public showLoader:boolean=false;
  
  // Role-based authentication
  private currentUserSubject: BehaviorSubject<User | null>;
  public currentUserRole: Observable<User | null>;

  constructor(private afu: AngularFireAuth, private router: Router,public ngZone: NgZone) {
    this.afu.authState.subscribe((auth: any) => {
      this.authState = auth;
    });

    // Initialize role-based user subject from localStorage
    const storedUser = localStorage.getItem('currentUser');
    let parsedUser: User | null = null;
    
    if (storedUser) {
      try {
        parsedUser = JSON.parse(storedUser);
        console.log('User loaded from localStorage:', parsedUser);
      } catch (e) {
        console.error('Error parsing stored user', e);
        localStorage.removeItem('currentUser');
      }
    }
    
    this.currentUserSubject = new BehaviorSubject<User | null>(parsedUser);
    this.currentUserRole = this.currentUserSubject.asObservable();
  }

  // all firebase getdata functions

  get isUserAnonymousLoggedIn(): boolean {
    return this.authState !== null ? this.authState.isAnonymous : false;
  }

  get currentUserId(): string {
    return this.authState !== null ? this.authState.uid : '';
  }

  get currentUserName(): string {
    return this.authState['email'];
  }

  get currentUser(): any {
    return this.authState !== null ? this.authState : null;
  }

  get isUserEmailLoggedIn(): boolean {
    if (this.authState !== null && !this.isUserAnonymousLoggedIn) {
      return true;
    } else {
      return false;
    }
  }

  registerWithEmail(email: string, password: string) {
    return this.afu
      ['createUserWithEmailAndPassword'](email, password)
      .then((user: any) => {
        this.authState = user;
      })
      .catch((_error: any) => {
        console.log(_error);
        throw _error;
      });
  }

  loginWithEmail(email: string, password: string) {
    return this.afu
      ['signInWithEmailAndPassword'](email, password)
      .then((user: any) => {
        this.authState = user;
      })
      .catch((_error: any) => {
        console.log(_error);
        throw _error;
      });
  }

  singout(): void {
    // this.afu.signOut();
    this.router.navigate(['/login']);
  }
  

    // Sign up with email/password
    SignUp(email:any, password:any) {
      return this.afAuth.createUserWithEmailAndPassword(email, password)
        .then((result:any) => {
          /* Call the SendVerificaitonMail() function when new user sign
          up and returns promise */
          this.SendVerificationMail();
          this.SetUserData(result.user);
        }).catch((error:any) => {
          window.alert(error.message)
        })
    }


    // main verification function
    SendVerificationMail() {
      return this.afAuth.currentUser.then((u:any) => u.sendEmailVerification()).then(() => {
          this.router.navigate(['/dashboard']);
        })
    }
      // Set user
  SetUserData(user:any) {
    const userRef: AngularFirestoreDocument<any> = this.afs.doc(`users/${user.uid}`);
    const userData: User = {
      email: user.email,
      displayName: user.displayName,
      uid: user.uid,
      photoURL: user.photoURL || 'src/favicon.ico',
      emailVerified: user.emailVerified
    };
    userRef.delete().then(function () {})
          .catch(function (error:any) {});
    return userRef.set(userData, {
      merge: true
    });
  }
 // sign in function
 SignIn(email:any, password:any) {
  return this.afAuth.signInWithEmailAndPassword(email, password)
    .then((result:any) => {
      if (result.user.emailVerified !== true) {
        this.SetUserData(result.user);
        this.SendVerificationMail();
        this.showLoader = true;
      } else {
        this.showLoader = false;
        this.ngZone.run(() => {
          this.router.navigate(['/auth/login']);
        });
      }
    }).catch((error:any) => {
      throw error;
    })
}
ForgotPassword(passwordResetEmail:any) {
  return this.afAuth.sendPasswordResetEmail(passwordResetEmail)
    .then(() => {
      window.alert('Password reset email sent, check your inbox.');
    }).catch((error:any) => {
      window.alert(error);
    });
}

  // Role-based authentication methods
  public get currentUserValue(): User | null {
    return this.currentUserSubject.value;
  }

  public get userRole(): string | null {
    return this.currentUserSubject.value?.role || null;
  }

  // Mock role-based login (replace with actual API call)
  loginWithRole(username: string, password: string): Observable<User> {
    return new Observable(observer => {
      setTimeout(() => {
        let user: User;
        
        // Mock user based on credentials
        if (username === 'superadmin' && password === 'admin123') {
          user = {
            uid: '1',
            email: 'superadmin@buspulse.com',
            displayName: 'Super Admin',
            photoURL: '',
            emailVerified: true,
            role: 'superadmin'
          };
        } else if (username === 'admin' && password === 'admin123') {
          user = {
            uid: '2',
            email: 'admin@buspulse.com',
            displayName: 'Admin User',
            photoURL: '',
            emailVerified: true,
            role: 'admin'
          };
        } else if (username === 'inspector' && password === 'inspector123') {
          user = {
            uid: '3',
            email: 'inspector@buspulse.com',
            displayName: 'Inspector User',
            photoURL: '',
            emailVerified: true,
            role: 'inspector'
          };
        } else if (username === 'client' && password === 'client123') {
          user = {
            uid: '4',
            email: 'client@buspulse.com',
            displayName: 'Client User',
            photoURL: '',
            emailVerified: true,
            role: 'client'
          };
        } else {
          observer.error({ message: 'Invalid username or password' });
          return;
        }

        // Store user details in local storage
        localStorage.setItem('currentUser', JSON.stringify(user));
        this.currentUserSubject.next(user);
        observer.next(user);
        observer.complete();
      }, 1000);
    });
  }

  logout(): void {
    localStorage.removeItem('currentUser');
    this.currentUserSubject.next(null);
    this.router.navigate(['/custom/sign-in']);
  }

  isAuthenticated(): boolean {
    return !!this.currentUserValue;
  }

  hasRole(roles: string[]): boolean {
    const userRole = this.userRole;
    return userRole ? roles.includes(userRole) : false;
  }

  isSuperAdmin(): boolean {
    return this.userRole === 'superadmin';
  }

  isAdmin(): boolean {
    return this.userRole === 'admin';
  }

  isInspector(): boolean {
    return this.userRole === 'inspector';
  }

  isClient(): boolean {
    return this.userRole === 'client';
  }
}
