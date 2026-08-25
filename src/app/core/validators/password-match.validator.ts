import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export function passwordsMatchValidator(passwordControlName: string, confirmControlName: string): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const password = group.get(passwordControlName);
    const confirm = group.get(confirmControlName);

    if (!password || !confirm || !confirm.value) {
      return null;
    }

    if (password.value !== confirm.value) {
      confirm.setErrors({ ...confirm.errors, passwordsMismatch: true });
    } else if (confirm.hasError('passwordsMismatch')) {
      const { passwordsMismatch, ...rest } = confirm.errors ?? {};
      confirm.setErrors(Object.keys(rest).length ? rest : null);
    }

    return null;
  };
}
