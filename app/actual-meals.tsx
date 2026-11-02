"use client";

/* eslint-disable @next/next/no-img-element */
import { useState,useSyncExternalStore } from "react";
import { Camera,Pencil,Plus,Utensils } from "lucide-react";
import { mealTypeLabels,type MealImage,type MealRecord,type MealType } from "@/lib/fat-loss";
import { dailyNutrition } from "@/lib/nutrition";

type Props = {
  meals:MealRecord[];
  title:string;
  onEdit:(meal:MealRecord)=>void;
  onAdd:(type:MealType)=>void;
};

export default function ActualMeals({ meals,title,onEdit,onAdd }:Props) {
  return <section aria-label={title} className="border-y border-[#d4e1e8] bg-white px-4 py-5 sm:rounded-lg sm:border">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-lg font-bold"><Utensils size={20} className="text-[#397b9c]"/>{title}</h2>
      <span className="text-xs font-semibold text-[#397b9c]">实际已保存 · {meals.length} 条</span>
    </div>
    <p className="mt-2 text-sm leading-6 text-[#667165]">只统计你保存或明确确认吃过的内容，推荐菜单不计入实际摄入。</p>
    <div className="mt-3 divide-y divide-[#e3e9ec]">
      {(Object.keys(mealTypeLabels) as MealType[]).map((type) => {
        const records=meals.filter((meal) => meal.meal_type===type);
        return <div key={type} role="group" aria-label={`实际${mealTypeLabels[type]}`} className="py-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="font-bold">{mealTypeLabels[type]}</h3>
            <button onClick={() => onAdd(type)} className="flex min-h-11 shrink-0 items-center gap-1 rounded-md border border-[#cfdee5] px-3 text-sm font-semibold text-[#326a86]"><Plus size={16}/>新增{mealTypeLabels[type]}</button>
          </div>
          {!records.length ? <p className="py-2 text-sm text-[#737d82]">尚未记录</p> : <div className="space-y-3">{records.map((meal) => {
            const nutrition=dailyNutrition([meal]);
            return <article key={meal.id} data-meal-id={meal.id} className="border-l-4 border-[#8fb6c9] bg-[#f5f9fb] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 break-words"><h4 className="font-bold">{meal.food_name}</h4><p className="mt-1 text-sm text-[#667165]">份量：{meal.portion || "待补充"}</p></div>
                <button onClick={() => onEdit(meal)} className="flex min-h-11 shrink-0 items-center gap-1 rounded-md border border-[#cfdee5] bg-white px-3 text-sm font-semibold"><Pencil size={15}/>编辑</button>
              </div>
              {nutrition.recorded ? <div className="mt-3 text-sm leading-6" data-nutrition="known"><p className="font-semibold">热量估计 {nutrition.calories_min}–{nutrition.calories_max} kcal</p><p>蛋白质 {nutrition.protein_g} g · 脂肪 {nutrition.fat_g} g · 碳水 {nutrition.carbohydrate_g} g</p></div> : <p data-nutrition="unknown" className="mt-3 text-sm leading-6 text-[#8a5b2d]">营养待补充：热量、蛋白质、脂肪和碳水未知，未按零计入。</p>}
              {meal.notes && <p className="mt-2 break-words text-sm leading-6 text-[#667165]">备注：{meal.notes}</p>}
              {meal.images.length>0 && <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{meal.images.map((image) => <MealPhoto key={`${image.id}-${image.signed_url || "missing"}`} image={image}/>)}</div>}
            </article>;
          })}</div>}
        </div>;
      })}
    </div>
  </section>;
}

function MealPhoto({ image }: { image:MealImage }) {
  const [failed,setFailed]=useState(false);
  return image.signed_url && !failed ? <a href={image.signed_url} target="_blank" rel="noreferrer" title="查看餐食照片" className="block aspect-[4/3] overflow-hidden rounded border border-[#dbe5e9] bg-white"><img src={image.signed_url} alt="餐食照片" onError={() => setFailed(true)} className="h-full w-full object-contain"/></a> : <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded border border-[#dbe5e9] bg-white p-2 text-center text-xs text-[#667165]"><Camera size={20}/>照片暂不可读取，原记录保留</div>;
}

const subscribe=() => () => undefined;
const currentOrigin=() => window.location.origin;
export function LocalDataNotice() {
  const origin=useSyncExternalStore(subscribe,currentOrigin,() => "本地预览");
  return <aside aria-label="本地数据隔离提示" className="mb-4 border-l-4 border-[#8fb6c9] bg-[#eef6fa] px-3 py-2 text-xs leading-6 text-[#365b70]"><strong className="break-all">当前数据地址：{origin}</strong><p>3007、3008 与其他端口的数据各自独立。此页只显示当前地址保存的记录；换端口需用完整 ZIP 手动导入，不会自动复制或清空。</p></aside>;
}
