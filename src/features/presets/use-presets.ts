import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createPreset, deletePreset, listPresets } from '@/lib/agent/presets';

/** List saved assistant presets from the configured deployment. */
export function usePresets() {
  return useQuery({ queryKey: ['presets'], queryFn: listPresets });
}

/** Save a named preset, then refresh the list. */
export function useCreatePreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createPreset,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['presets'] }),
  });
}

/** Delete a preset, then refresh the list. */
export function useDeletePreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deletePreset,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['presets'] }),
  });
}
