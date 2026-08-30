import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { ImagePlus, Link as LinkIcon, Save } from "lucide-react";
import { api, resolveImageUrl } from "../../../lib/api";
import { useToast } from "../../../hooks/useToast";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";

type CateringPackage = {
  id: string;
  stationType?: string;
  name: string;
  description: string | null;
  minPax: number;
  maxPax: number;
  imageUrl: string | null;
  items: {
    pricingType?: "flat" | "range" | "quote";
    flatPrice?: number;
    minPrice?: number;
    maxPrice?: number;
    galleryImages?: Array<string | null>;
  } | null;
};

type PhotoForm = {
  imageUrls: string[];
  imageFiles: Array<File | null>;
  previewUrls: string[];
  localPreviewUrls: Array<string | null>;
};

const stations = [
  { id: "sushi_station", name: "Sushi Station" },
  { id: "sashimi_bar", name: "Sashimi Bar" },
  { id: "tempura_live", name: "Tempura Live" }
];

function getStationType(item: CateringPackage) {
  if (item.stationType) {
    return item.stationType;
  }

  if (item.id.includes("sashimi")) {
    return "sashimi_bar";
  }

  if (item.id.includes("tempura")) {
    return "tempura_live";
  }

  return "sushi_station";
}

function money(value: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 }).format(value);
}

function priceLabel(item: CateringPackage) {
  if (item.items?.pricingType === "flat") {
    return money(item.items.flatPrice ?? 0);
  }

  if (item.items?.pricingType === "range") {
    return `${money(item.items.minPrice ?? 0)}-${money(item.items.maxPrice ?? 0)}`;
  }

  return "Custom quote";
}

function initialForm(item: CateringPackage): PhotoForm {
  const galleryImages = item.items?.galleryImages?.length ? item.items.galleryImages : [item.imageUrl];
  const imageUrls = Array.from({ length: 3 }, (_, index) => galleryImages[index] ?? "");

  return {
    imageUrls,
    imageFiles: [null, null, null],
    previewUrls: imageUrls.map((imageUrl) => resolveImageUrl(imageUrl) ?? ""),
    localPreviewUrls: [null, null, null]
  };
}

function revokeLocalPreviews(form?: PhotoForm) {
  form?.localPreviewUrls.forEach((localPreviewUrl) => {
    if (localPreviewUrl) {
      URL.revokeObjectURL(localPreviewUrl);
    }
  });
}

export default function CateringOptionPhotos() {
  const [forms, setForms] = useState<Record<string, PhotoForm>>({});
  const formsRef = useRef(forms);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const packagesQuery = useQuery({
    queryKey: ["catering-packages"],
    queryFn: async () => (await api.get<{ packages: CateringPackage[] }>("/api/catering/packages")).data.packages
  });

  useEffect(() => {
    if (!packagesQuery.data) {
      return;
    }

    setForms((current) => {
      const next: Record<string, PhotoForm> = {};

      packagesQuery.data.forEach((item) => {
        next[item.id] = current[item.id]?.imageFiles.some(Boolean) ? current[item.id] : initialForm(item);
      });

      return next;
    });
  }, [packagesQuery.data]);

  useEffect(() => {
    formsRef.current = forms;
  }, [forms]);

  useEffect(() => {
    return () => {
      Object.values(formsRef.current).forEach(revokeLocalPreviews);
    };
  }, []);

  const packagesByStation = useMemo(() => {
    const map = new Map<string, CateringPackage[]>();

    stations.forEach((station) => map.set(station.id, []));
    (packagesQuery.data ?? []).forEach((item) => {
      const stationType = getStationType(item);
      map.set(stationType, [...(map.get(stationType) ?? []), item]);
    });

    return map;
  }, [packagesQuery.data]);

  const savePhotoMutation = useMutation({
    mutationFn: async (item: CateringPackage) => {
      const form = forms[item.id] ?? initialForm(item);
      const formData = new FormData();

      formData.append("image_urls", JSON.stringify(form.imageUrls));
      form.imageFiles.forEach((imageFile, index) => {
        if (imageFile) {
          formData.append(`imageFile_${index}`, imageFile);
        }
      });

      return api.put(`/api/admin/catering/packages/${item.id}/photos`, formData);
    },
    onSuccess: (response, item) => {
      const savedPackage = response.data.package as CateringPackage;

      setForms((current) => {
        const existing = current[item.id];

        revokeLocalPreviews(existing);

        return {
          ...current,
          [item.id]: initialForm(savedPackage)
        };
      });
      queryClient.invalidateQueries({ queryKey: ["catering-packages"] });
      toast("Catering option photos updated.");
    },
    onError: (error) => {
      const message = axios.isAxiosError<{ message?: string }>(error)
        ? error.response?.data?.message
        : null;
      toast(message ?? "Unable to update catering option photos.");
    }
  });

  function updateUrl(item: CateringPackage, index: number, imageUrl: string) {
    setForms((current) => {
      const existing = current[item.id] ?? initialForm(item);
      const localPreviewUrl = existing.localPreviewUrls[index];

      if (localPreviewUrl) {
        URL.revokeObjectURL(localPreviewUrl);
      }

      const imageUrls = [...existing.imageUrls];
      const imageFiles = [...existing.imageFiles];
      const previewUrls = [...existing.previewUrls];
      const localPreviewUrls = [...existing.localPreviewUrls];

      imageUrls[index] = imageUrl;
      imageFiles[index] = null;
      previewUrls[index] = resolveImageUrl(imageUrl) ?? "";
      localPreviewUrls[index] = null;

      return {
        ...current,
        [item.id]: {
          imageUrls,
          imageFiles,
          previewUrls,
          localPreviewUrls
        }
      };
    });
  }

  function updateFile(item: CateringPackage, index: number, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;

    if (!file) {
      return;
    }

    setForms((current) => {
      const existing = current[item.id] ?? initialForm(item);
      const localPreviewUrl = existing.localPreviewUrls[index];

      if (localPreviewUrl) {
        URL.revokeObjectURL(localPreviewUrl);
      }

      const nextLocalPreviewUrl = URL.createObjectURL(file);
      const imageFiles = [...existing.imageFiles];
      const previewUrls = [...existing.previewUrls];
      const localPreviewUrls = [...existing.localPreviewUrls];

      imageFiles[index] = file;
      previewUrls[index] = nextLocalPreviewUrl;
      localPreviewUrls[index] = nextLocalPreviewUrl;

      return {
        ...current,
        [item.id]: {
          ...existing,
          imageFiles,
          previewUrls,
          localPreviewUrls
        }
      };
    });
  }

  function submit(event: FormEvent<HTMLFormElement>, item: CateringPackage) {
    event.preventDefault();
    savePhotoMutation.mutate(item);
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-red-700">Admin only</p>
          <CardTitle className="mt-1">Catering Option Photos</CardTitle>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
          3 photos per option
        </span>
      </CardHeader>
      <CardContent>
        {packagesQuery.isLoading && <p className="text-sm text-slate-500">Loading catering options...</p>}
        {packagesQuery.isError && <p className="text-sm text-red-700">Unable to load catering options.</p>}

        <div className="grid gap-6">
          {stations.map((station) => {
            const stationPackages = packagesByStation.get(station.id) ?? [];

            if (stationPackages.length === 0) {
              return null;
            }

            return (
              <section key={station.id} className="grid gap-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-slate-900">{station.name}</h3>
                  <span className="text-xs font-semibold text-slate-500">{stationPackages.length} option{stationPackages.length === 1 ? "" : "s"}</span>
                </div>

                <div className="grid gap-4">
                  {stationPackages.map((item) => {
                    const form = forms[item.id] ?? initialForm(item);
                    const pending = savePhotoMutation.isPending && savePhotoMutation.variables?.id === item.id;

                    return (
                      <form
                        key={item.id}
                        className="grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-sm"
                        onSubmit={(event) => submit(event, item)}
                      >
                        <div>
                          <p className="break-words text-base font-black text-slate-950">{item.description ?? item.name}</p>
                          <p className="mt-1 text-sm text-slate-600">{item.minPax}-{item.maxPax} pax - {priceLabel(item)}</p>
                        </div>

                        <div className="grid gap-3 xl:grid-cols-3">
                          {[0, 1, 2].map((index) => (
                            <div key={index} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3">
                              <div className="aspect-[4/3] overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                                {form.previewUrls[index] ? (
                                  <img src={form.previewUrls[index]} alt={`${item.description ?? item.name} photo ${index + 1}`} className="h-full w-full object-cover" />
                                ) : (
                                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-slate-400">
                                    <ImagePlus className="h-7 w-7" />
                                    <span className="text-xs font-semibold uppercase tracking-wide">Photo {index + 1}</span>
                                  </div>
                                )}
                              </div>

                              <label className="grid gap-1 text-sm font-medium text-slate-700">
                                <span className="inline-flex items-center gap-2">
                                  <LinkIcon className="h-4 w-4 text-slate-400" />
                                  Photo {index + 1} URL
                                </span>
                                <input
                                  className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100"
                                  placeholder="/images/catering/example.jpg"
                                  value={form.imageUrls[index]}
                                  onChange={(event) => updateUrl(item, index, event.target.value)}
                                />
                              </label>

                              <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-100">
                                <ImagePlus className="h-4 w-4" />
                                Upload
                                <input className="sr-only" type="file" accept="image/*" onChange={(event) => updateFile(item, index, event)} />
                              </label>
                            </div>
                          ))}
                        </div>

                        <div className="flex justify-end">
                          <Button className="gap-2" disabled={pending} type="submit">
                            <Save className="h-4 w-4" />
                            {pending ? "Saving..." : "Save photos"}
                          </Button>
                        </div>
                      </form>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
