import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../lib/api";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { useToast } from "../../../hooks/useToast";
import { ConversionRule } from "./types";

export default function ConversionRulesEditor() {
  const [drafts, setDrafts] = useState<Record<string, ConversionRule>>({});
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const rulesQuery = useQuery({
    queryKey: ["inventory", "conversion-rules"],
    queryFn: async () => {
      const response = await api.get<{ rules: ConversionRule[] }>("/api/inventory/conversion-rules");
      return response.data.rules;
    }
  });

  const updateMutation = useMutation({
    mutationFn: async (rule: ConversionRule) => api.put(`/api/inventory/conversion-rules/${rule.id}`, rule),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory", "conversion-rules"] });
      toast("Conversion rule saved.");
    },
    onError: () => toast("Unable to save conversion rule.")
  });

  function getDraft(rule: ConversionRule) {
    return drafts[rule.id] ?? rule;
  }

  function updateDraft(rule: ConversionRule, field: keyof ConversionRule, value: string) {
    setDrafts((current) => ({
      ...current,
      [rule.id]: {
        ...getDraft(rule),
        [field]: value
      }
    }));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conversion Rules</CardTitle>
      </CardHeader>
      <CardContent>
        {rulesQuery.isLoading && <p className="text-sm text-slate-500">Loading conversion rules...</p>}
        {rulesQuery.isError && <p className="text-sm text-red-700">Unable to load conversion rules.</p>}
        {!rulesQuery.isLoading && !rulesQuery.isError && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>From Quantity</TableHead>
                  <TableHead>From Unit</TableHead>
                  <TableHead>To Quantity</TableHead>
                  <TableHead>To Unit</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(rulesQuery.data ?? []).map((rule) => {
                  const draft = getDraft(rule);

                  return (
                    <TableRow key={rule.id}>
                      <TableCell>
                        <input className="h-9 min-w-48 rounded-md border border-slate-300 px-2 text-sm" value={draft.name} onChange={(event) => updateDraft(rule, "name", event.target.value)} />
                      </TableCell>
                      <TableCell>
                        <input className="h-9 w-28 rounded-md border border-slate-300 px-2 text-sm" type="number" step="0.001" value={draft.from_quantity} onChange={(event) => updateDraft(rule, "from_quantity", event.target.value)} />
                      </TableCell>
                      <TableCell>
                        <input className="h-9 w-40 rounded-md border border-slate-300 px-2 text-sm" value={draft.from_unit} onChange={(event) => updateDraft(rule, "from_unit", event.target.value)} />
                      </TableCell>
                      <TableCell>
                        <input className="h-9 w-28 rounded-md border border-slate-300 px-2 text-sm" type="number" step="0.001" value={draft.to_quantity} onChange={(event) => updateDraft(rule, "to_quantity", event.target.value)} />
                      </TableCell>
                      <TableCell>
                        <input className="h-9 w-40 rounded-md border border-slate-300 px-2 text-sm" value={draft.to_unit} onChange={(event) => updateDraft(rule, "to_unit", event.target.value)} />
                      </TableCell>
                      <TableCell>
                        <Button size="sm" onClick={() => updateMutation.mutate(draft)} disabled={updateMutation.isPending}>
                          Save
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
