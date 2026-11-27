import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { ChevronRight, Eye, ImagePlus, Link as LinkIcon, LockKeyhole, Save } from "lucide-react";
import { Link } from "react-router-dom";
import { api, resolveImageUrl } from "../../../lib/api";
import { useToast } from "../../../hooks/useToast";
import { Button } from "../../../components/ui/button";
import "../../../styles/staff-redesign.css";

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
  const [openOptionId, setOpenOptionId] = useState<string | null>(null);

  const packagesQuery = useQuery({
    queryKey: ["catering-packages"],
    queryFn: async () => (await api.get<{ packages: CateringPackage[] }>("/api/catering/packages")).data.packages
  });

  useEffect(() => {
    if (!packagesQuery.data) {
      return;
    }
    if (!openOptionId) {
      setOpenOptionId(packagesQuery.data[0]?.id ?? null);
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

  const maxPhotos = 3;
  return (
    <main className="staff-catering-photos">
      <article>
        <Link to="/staff/reservations" className="mb-5 inline-flex items-center gap-1 text-sm font-semibold text-[#6a7185] hover:text-[#9b1d20]"><ChevronRight className="h-4 w-4 rotate-180" />Back to reservations</Link>
        <div className="mb-7 flex flex-wrap items-start justify-between gap-5">
          <div>
            <span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-[#fbeaea] px-3 py-1.5 text-[12px] font-bold uppercase tracking-[.14em] text-[#9b1d20]"><LockKeyhole className="h-3.5 w-3.5" />Admin only</span>
            <h1>Catering option photos</h1>
            <p className="mt-2 text-sm text-[#6a7185]">Add up to three photos for each catering option.</p>
          </div>
          <span className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-4 text-xs font-bold text-[#1c2030] shadow-[0_1px_2px_rgba(60,20,25,.04)]"><ImagePlus className="h-4 w-4 text-[#9b1d20]" />{maxPhotos} photos per option</span>
        </div>
        {packagesQuery.isLoading && <p className="text-sm text-slate-500">Loading catering options...</p>}
        {packagesQuery.isError && <p className="text-sm text-red-700">Unable to load catering options.</p>}
        {stations.map((station) => {
          const stationPackages = packagesByStation.get(station.id) ?? [];
          if (stationPackages.length === 0) return null;
          return (
            <section key={station.id} className="mb-7">
              <div className="package-heading mb-3">
                <h3 className="text-[13px] font-bold uppercase tracking-[.14em]">{station.name}</h3>
                <span className="package-count px-3 py-1 text-xs font-bold">{stationPackages.length} option{stationPackages.length === 1 ? "" : "s"}</span>
              </div>
              {stationPackages.map((item) => {
                const form = forms[item.id] ?? initialForm(item);
                const pending = savePhotoMutation.isPending && savePhotoMutation.variables?.id === item.id;
                const photoCount = form.imageUrls.filter(Boolean).length;
                const isOpen = openOptionId === item.id;
                return (
                  <form key={item.id} className="staff-option-card" onSubmit={(event) => submit(event, item)}>
                    <button type="button" className="staff-option-header" aria-expanded={isOpen} aria-controls={`photos-${item.id}`} onClick={() => setOpenOptionId(isOpen ? null : item.id)}>
                      <div>
                        <p className="text-[18px] font-black text-[#1c2030]">{item.description ?? item.name}</p>
                        <p className="mt-1 text-sm text-[#6a7185]">{item.minPax}-{item.maxPax} pax · {priceLabel(item)}</p>
                      </div>
                      <div className="staff-option-thumbs flex -space-x-2">
                        {form.previewUrls.filter(Boolean).slice(0,maxPhotos).map((url,index) => <img key={index} src={url} alt="" className="h-9 w-9 rounded-full border-2 border-white object-cover" />)}
                      </div>
                      <span className={`staff-option-complete inline-flex h-8 items-center rounded-full px-3 text-xs font-bold ${photoCount === maxPhotos ? "bg-[#e1f4ea] text-[#14633a]" : "bg-[#fdf1d9] text-[#6e4500]"}`}>{photoCount === maxPhotos ? "✓ " : ""}{photoCount} of {maxPhotos} photos</span>
                      <ChevronRight className="staff-option-chevron h-5 w-5 justify-self-end" />
                    </button>
                    {isOpen && (
                      <div id={`photos-${item.id}`} className="staff-photo-grid">
                        {[0,1,2].map((index) => (
                          <div key={index} className="staff-photo-card">
                            <div className="staff-photo-preview">
                              {form.previewUrls[index] ? (
                                <>
                                  <img src={form.previewUrls[index]} alt={`${item.description ?? item.name} photo ${index+1}`} />
                                  <span className="staff-photo-tag">Photo {index+1}</span>
                                  <div className="staff-photo-overlay">
                                    <label className="cursor-pointer rounded-full bg-white px-3 py-2 text-xs font-bold text-[#1c2030]">Replace<input className="sr-only" type="file" accept="image/*" onChange={(event) => updateFile(item,index,event)} /></label>
                                    <a href={form.previewUrls[index]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full bg-white/20 px-3 py-2 text-xs font-bold text-white"><Eye className="h-3.5 w-3.5" />Preview</a>
                                  </div>
                                </>
                              ) : (
                                <label className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-2 text-[#9b1d20]">
                                  <span className="grid h-11 w-11 place-items-center rounded-full bg-[#fbeaea]"><ImagePlus className="h-6 w-6" /></span>
                                  <strong>Add photo {index+1}</strong><span className="text-xs text-[#6a7185]">Click to upload</span>
                                  <input className="sr-only" type="file" accept="image/*" onChange={(event) => updateFile(item,index,event)} />
                                </label>
                              )}
                            </div>
                            <div className="staff-photo-url-row">
                              <label><LinkIcon className="h-4 w-4" /><span className="sr-only">Photo {index+1} URL</span><input placeholder="/images/catering/example.jpg" value={form.imageUrls[index]} onChange={(event) => updateUrl(item,index,event.target.value)} /></label>
                              <label className="flex h-[42px] cursor-pointer items-center justify-center rounded-[10px] border border-[#e6b9bb] bg-white text-xs font-bold text-[#9b1d20]">Upload<input className="sr-only" type="file" accept="image/*" onChange={(event) => updateFile(item,index,event)} /></label>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </form>
                );
              })}
            </section>
          );
        })}
        <div className="staff-save-bar">
          <p className="text-sm text-[#6a7185]">Review your photo links, then save.</p>
          <Button type="button" className="h-12 gap-2 bg-gradient-to-r from-[#b3202a] to-[#7f1219] px-6 text-white shadow-[0_8px_18px_rgba(155,29,32,.2)]" disabled={savePhotoMutation.isPending} onClick={() => { const item=(packagesQuery.data??[]).find((entry)=>entry.id===openOptionId); if(item) savePhotoMutation.mutate(item); }}>
            <Save className="h-4 w-4" />{savePhotoMutation.isPending ? "Saving..." : "Save photos"}
          </Button>
        </div>
      </article>
    </main>
  );
}
