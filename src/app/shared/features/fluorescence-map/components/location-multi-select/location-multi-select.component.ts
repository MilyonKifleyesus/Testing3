import { CommonModule } from '@angular/common';
import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

export interface LocationMultiSelectOption {
  id: number | string;
  name: string;
  latitude?: number | null;
  longitude?: number | null;
}

@Component({
  selector: 'app-location-multi-select',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './location-multi-select.component.html',
  styleUrl: './location-multi-select.component.scss',
})
export class LocationMultiSelectComponent {
  options = input<LocationMultiSelectOption[]>([]);
  value = input<number[]>([]);
  disabled = input<boolean>(false);
  placeholder = input<string>('Search locations...');

  valueChange = output<number[]>();

  readonly searchTerm = signal('');

  readonly selectedSet = computed(() => new Set(this.value() ?? []));
  readonly filteredOptions = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) return this.options();
    return this.options().filter((option) => {
      const haystack = `${option.name} ${option.latitude ?? ''} ${option.longitude ?? ''}`.toLowerCase();
      return haystack.includes(term);
    });
  });
  readonly selectedOptions = computed(() => {
    const selected = this.selectedSet();
    return this.options().filter((option) => selected.has(this.toNumberId(option.id)));
  });

  toggleOption(optionId: number | string): void {
    if (this.disabled()) return;
    const id = this.toNumberId(optionId);
    const next = new Set(this.value() ?? []);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.valueChange.emit(Array.from(next.values()));
  }

  removeChip(optionId: number | string): void {
    if (this.disabled()) return;
    const id = this.toNumberId(optionId);
    const next = (this.value() ?? []).filter((entry) => entry !== id);
    this.valueChange.emit(next);
  }

  isSelected(optionId: number | string): boolean {
    return this.selectedSet().has(this.toNumberId(optionId));
  }

  onSearchChange(value: string): void {
    this.searchTerm.set(value);
  }

  private toNumberId(raw: number | string): number {
    const parsed = Number.parseInt(String(raw), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}

