import { Injectable, computed } from '@angular/core';

import { FluorescenceMapFilteredState, FluorescenceMapSelectionState } from '../fluorescence-map.types';
import { FleetSelection, Node } from '../../../models/fluorescence-map.interface';
import { ActivityLogRow } from '../models/fleet-vm.models';
import { buildCanonicalNodeIdCandidates, normalizeCanonicalId } from '../state/fluorescence-map-normalization';

interface SelectionInputs {
  selectedEntity: () => FleetSelection | null;
  selectedRouteId: () => string | null;
  filteredState: () => FluorescenceMapFilteredState;
}

@Injectable({ providedIn: 'root' })
export class FluorescenceMapSelectionFacade {
  createSelectionState(inputs: SelectionInputs) {
    return computed<FluorescenceMapSelectionState>(() => {
      const selected = inputs.selectedEntity();
      const selectedRouteId = inputs.selectedRouteId();
      const filteredState = inputs.filteredState();
      const visibleNodeIds = new Set<string>();
      filteredState.strictMapNodes.forEach((node) =>
        buildCanonicalNodeIdCandidates(node.id).forEach((candidate) => visibleNodeIds.add(candidate)),
      );

      const selectedEntityVisible =
        !selected ||
        [
          selected.id,
          selected.factoryId,
          selected.manufacturerLocationId,
        ]
          .flatMap((candidate) => buildCanonicalNodeIdCandidates(candidate ?? null))
          .some((candidate) => visibleNodeIds.has(candidate));

      const visibleRouteIds = new Set(filteredState.strictMapProjectRoutes.map((route) => route.id));
      const selectedRouteVisible = !selectedRouteId || visibleRouteIds.has(selectedRouteId);
      const selectionInvalidated =
        filteredState.filtersActive &&
        ((!selectedEntityVisible && !!selected) || (!selectedRouteVisible && !!selectedRouteId));

      return {
        selectedEntityVisible,
        selectedRouteVisible,
        selectionInvalidated,
        noticeMessage:
          selectionInvalidated && !filteredState.mapState.showEmptyState
            ? 'Current selection is outside applied filters'
            : null,
        selectedProjectIdFromSelection: this.deriveSelectedProjectId(
          selected,
          filteredState.activityTableRows,
        ),
      };
    });
  }

  deriveSelectedProjectIdFromNode(node: Node, rows: ActivityLogRow[]): string | null {
    const manufacturerLocationId = normalizeCanonicalId(node.manufacturerLocationId ?? node.factoryId);
    if (manufacturerLocationId) {
      const matchingRow = rows.find(
        (row) => normalizeCanonicalId(row.manufacturerLocationId ?? row.locationId) === manufacturerLocationId,
      );
      if (matchingRow) {
        return matchingRow.projectId;
      }
    }

    const clientId = normalizeCanonicalId(node.companyId ?? node.clientId ?? node.id);
    if (!clientId) {
      return null;
    }

    const matchingRow = rows.find((row) => normalizeCanonicalId(row.clientId) === clientId);
    return matchingRow?.projectId ?? null;
  }

  private deriveSelectedProjectId(
    selection: FleetSelection | null,
    rows: ActivityLogRow[],
  ): string | null {
    if (!selection) return null;

    const selectionId = normalizeCanonicalId(
      selection.manufacturerLocationId ?? selection.factoryId ?? selection.id,
    );
    if (!selectionId) return null;

    const row = rows.find((candidate) => {
      const candidates = [
        candidate.manufacturerLocationId,
        candidate.locationId,
        candidate.manufacturerId,
        candidate.clientId,
      ];
      return candidates.some((value) => normalizeCanonicalId(value) === selectionId);
    });
    return row?.projectId ?? null;
  }
}
