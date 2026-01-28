import { Component, ElementRef, Inject, Renderer2, importProvidersFrom } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../shared/services/auth.service';
import { AngularFireAuthModule } from '@angular/fire/compat/auth';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { AngularFireModule, FIREBASE_OPTIONS } from '@angular/fire/compat';
import { AngularFirestoreModule } from '@angular/fire/compat/firestore';
import { AngularFireDatabaseModule } from '@angular/fire/compat/database';
import { environment } from '../../../environments/environment';
import { FirebaseService } from '../../shared/services/firebase.service';
import { ToastrModule, ToastrService } from 'ngx-toastr';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { DOCUMENT, CommonModule } from '@angular/common';
import { DomSanitizer } from '@angular/platform-browser';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, RouterModule,NgbModule,AngularFireAuthModule,FormsModule, ReactiveFormsModule ,AngularFireModule,
    AngularFireDatabaseModule,
    AngularFirestoreModule,ToastrModule
],
  
    providers: [FirebaseService,{ provide: ToastrService, useClass: ToastrService }],


  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent {
  public showPassword = false;
  disabled = '';
  active: any="Angular";
  showLoader:boolean | undefined;

  constructor(
    @Inject(DOCUMENT) private document: Document,private elementRef: ElementRef,
   private sanitizer: DomSanitizer,
    public authservice: AuthService,
    private router: Router,
    private formBuilder: FormBuilder,
    private renderer: Renderer2,
    private firebaseService: FirebaseService,
    private toastr: ToastrService 
  ) {
    // AngularFireModule.initializeApp(environment.firebase);

     const bodyElement = this.renderer.selectRootElement('body', true);
    //  this.renderer.setAttribute(bodyElement, 'class', 'cover1 justify-center');
  }
  firestoreModule: any;
  databaseModule: any;
  authModule: any;
  ngOnInit(): void {
    this.renderer.addClass(this.document.body, 'error-1');
    this.loginForm = this.formBuilder.group({
      username: ['superadmin', [Validators.required, Validators.email]],
      password: ['admin123', Validators.required],
    });

    this.firestoreModule = this.firebaseService.getFirestore();
    this.databaseModule = this.firebaseService.getDatabase();
    this.authModule = this.firebaseService.getAuth();
  }
  // firebase
  email = 'superadmin';
  password = 'admin123';
  errorMessage = ''; // validation _error handle
  _error: { name: string; message: string } = { name: '', message: '' }; // for firbase _error handle

  clearErrorMessage() {
    this.errorMessage = '';
    this._error = { name: '', message: '' };
  }

  login() {
    console.log(this.loginForm)

    // this.disabled = "btn-loading"
    this.clearErrorMessage();
    if (this.validateForm(this.email, this.password)) {
      // Use loginWithRole to properly set user role before navigation
      this.authservice.loginWithRole(this.email, this.password).subscribe({
        next: (user) => {
          console.clear();
          // Navigate based on role
          if (user.role === 'superadmin' || user.role === 'admin') {
            this.router.navigate(['/admin/dashboard']);
            this.toastr.success(`Login successful - ${user.role === 'superadmin' ? 'Super Admin' : 'Admin'}`, 'BusPulse', {
              timeOut: 3000,
              positionClass: 'toast-top-right',
            });
          } else if (user.role === 'client') {
            this.router.navigate(['/client/dashboard']);
            this.toastr.success('Login successful - Client', 'BusPulse', {
              timeOut: 3000,
              positionClass: 'toast-top-right',
            });
          } else if (user.role === 'inspector') {
            this.router.navigate(['/dashboard']);
            this.toastr.success('Login successful - Inspector', 'BusPulse', {
              timeOut: 3000,
              positionClass: 'toast-top-right',
            });
          }
        },
        error: (error) => {
          this._error = error;
          this.toastr.error('Invalid credentials', 'BusPulse', {
            timeOut: 3000,
            positionClass: 'toast-top-right',
          });
        }
      });
     
    }
    else {
      this.toastr.error('Invalid details','BusPulse', {
        timeOut: 3000,
        positionClass: 'toast-top-right',
      });
    }
  }

  validateForm(email: string, password: string) {
    if (email.length === 0) {
      this.errorMessage = 'please enter email id';
      return false;
    }

    if (password.length === 0) {
      this.errorMessage = 'please enter password';
      return false;
    }

    if (password.length < 6) {
      this.errorMessage = 'password should be at least 6 char';
      return false;
    }

    this.errorMessage = '';
    return true;
    
  }

  //angular
  public loginForm!: FormGroup;
  public error: any = '';

  get form() {
    return this.loginForm.controls;
  }

  Submit() {
    console.log(this.loginForm)
    const username = this.loginForm.controls['username'].value;
    const password = this.loginForm.controls['password'].value;
    
    // Use loginWithRole to properly set user role before navigation
    this.authservice.loginWithRole(username, password).subscribe({
      next: (user) => {
        console.clear();
        // Navigate based on role
        if (user.role === 'superadmin' || user.role === 'admin') {
          this.router.navigate(['/admin/dashboard']);
          this.toastr.success(`Login successful - ${user.role === 'superadmin' ? 'Super Admin' : 'Admin'}`, 'BusPulse', {
            timeOut: 3000,
            positionClass: 'toast-top-right',
          });
        } else if (user.role === 'client') {
          this.router.navigate(['/client/dashboard']);
          this.toastr.success('Login successful - Client', 'BusPulse', {
            timeOut: 3000,
            positionClass: 'toast-top-right',
          });
        } else if (user.role === 'inspector') {
          this.router.navigate(['/dashboard']);
          this.toastr.success('Login successful - Inspector', 'BusPulse', {
            timeOut: 3000,
            positionClass: 'toast-top-right',
          });
        }
      },
      error: (error) => {
        this.toastr.error('Invalid credentials', 'BusPulse', {
          timeOut: 3000,
          positionClass: 'toast-top-right',
        });
      }
    });
  }

  public togglePassword() {
    this.showPassword = !this.showPassword;
  }

  ngOnDestroy(): void {
    const bodyElement = this.renderer.selectRootElement('body', true);
    this.renderer.removeAttribute(bodyElement, 'class');
  }

  toggleClass = "off-line";
  toggleVisibility() {
    this.showPassword = !this.showPassword;
    if (this.toggleClass === "off-line") {
      this.toggleClass = "line";
    } else {
      this.toggleClass = "off-line";
    }
  }
}

