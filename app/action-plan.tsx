"use client";
import { useRef,useState } from "react";
import { ArrowLeft,ArrowRight,ArrowRightLeft,BookOpen,CalendarDays,Camera,Check,ChevronDown,Clock,Dumbbell,ExternalLink,Leaf,Loader2,Pencil,SkipForward,Utensils,X } from "lucide-react";
import type { AppData } from "@/lib/fat-loss";
import { addDays,formatChineseDate,todayString } from "@/lib/fat-loss";
import type { PlanTask,TaskUpdate } from "@/lib/plan-types";
import { mondayOf,nextActionAdvice,selectedPlanMeal,taskState,tasksForDate,weeklyReview } from "@/lib/action-plan";
import { NutritionOverview } from "./nutrition-panels";

type Props = { data: AppData; date: string; busy: boolean; onDate: (date: string) => void; onGenerate: (date: string,previous?: string,replace?: boolean) => Promise<void>; onUpdate: (task: PlanTask,patch: Partial<TaskUpdate>) => Promise<void>; onComplete: (task: PlanTask,minutes: number,atePlanned: boolean) => Promise<void>; onPhoto: (task: PlanTask,files: FileList) => Promise<void>; onRecords: () => void; onSettings: () => void };
const button = "plan-button";
const statusLabels = { completed: "已完成",skipped: "已跳过",later: "稍后执行",pending: "待执行" };
export default function ActionPlan(props: Props) {
  const { data,date,busy,onDate,onGenerate } = props;
  const [view,setView] = useState<"day"|"week"|"review">("day");
  const [editing,setEditing] = useState<PlanTask|null>(null);
  const [completing,setCompleting] = useState<PlanTask|null>(null);
  const [error,setError] = useState("");
  const [pending,setPending] = useState(false);
  const week = data.plans?.find((plan) => plan.week_start === mondayOf(date));
  const tasks = tasksForDate(data,date);
  const completed = tasks.filter((task) => taskState(data,task)==="completed").length;
  const skipped = tasks.filter((task) => taskState(data,task)==="skipped").length;
  const remaining = tasks.filter((task) => !["completed","skipped"].includes(taskState(data,task)));
  const now = new Date().toTimeString().slice(0,5);
  const next = date===todayString() ? remaining.find((task) => task.time>=now) || remaining.at(-1) : remaining[0];
  const advice = nextActionAdvice(data,date);
  const review = weeklyReview(data,mondayOf(date));
  async function run(action: () => Promise<void>) { if (pending || busy) return; setPending(true); setError(""); try { await action(); } catch(e) { setError(e instanceof Error ? e.message : "保存失败，请先导出备份。"); } finally { setPending(false); } }
  const disabled = busy || pending;
  return <div className="action-plan">
    <header className="plan-heading"><div><p className="plan-eyebrow">SHIGUANG / 每日行动教练</p><h1>今日减脂计划</h1><p>{formatChineseDate(date)} · {completed ? "已经完成的每一步都算数。" : "从一顿正常的饭、一个小行动开始。"}</p></div><button className={button} title="完善计划偏好" aria-label="完善计划偏好" onClick={props.onSettings}><Pencil size={16} /><span className="hidden sm:inline">计划偏好</span></button></header>
    <div className="plan-view-switch" role="tablist" aria-label="计划视图">{([["day","今日行动"],["week","本周总览"],["review","每周复盘"]] as const).map(([value,label]) => <button key={value} role="tab" aria-selected={view===value} onClick={() => setView(value)}>{label}</button>)}</div>
    <div className="plan-week"><button className={button} title="上一周" aria-label="上一周" onClick={() => onDate(addDays(date,-7))}><ArrowLeft size={16} /></button><span>{mondayOf(date).slice(5)} — {addDays(mondayOf(date),6).slice(5)}</span><button className={button} title="下一周" aria-label="下一周" onClick={() => onDate(addDays(date,7))}><ArrowRight size={16} /></button>{date!==todayString() && <button className={button} onClick={() => onDate(todayString())}>回到今天</button>}</div>
    {!week ? <section className="plan-empty"><CalendarDays size={28} /><h2>为这一周留出可执行的安排</h2><p>保留现有记录，新增周一至周日的饮食、运动与恢复安排。</p><button className={`${button} primary`} disabled={disabled} onClick={() => void run(() => onGenerate(date))}><CalendarDays size={16} />生成这一周</button></section> : <>
      <div className="plan-days" aria-label="选择计划日期">{week.days.map((day,index) => <button key={day.date} aria-pressed={day.date===date} onClick={() => onDate(day.date)}><span>{["一","二","三","四","五","六","日"][index]}</span><strong>{Number(day.date.slice(-2))}</strong><span className="day-mark">{tasksForDate(data,day.date).some((task) => taskState(data,task)==="completed") ? "已行动" : day.date===todayString() ? "今天" : day.focus.startsWith("恢复") ? "恢复" : "计划"}</span></button>)}</div>
      {week.notes.length>0 && <details className="plan-safety"><summary><Leaf size={16} />目标与安全边界 <ChevronDown size={14} /></summary><ul>{week.notes.map((note) => <li key={note}>{note}</li>)}</ul></details>}
      {view === "day" && <>
        <section className="plan-progress"><div><strong>{completed}<span> / {tasks.length} 项已完成</span></strong><p>{skipped ? `${skipped} 项已跳过；不用为了满分补做。` : "按真实状态完成，不追求满分。"}</p></div><progress aria-label="今日行动进度" max={tasks.length || 1} value={completed} /><div><span className="plan-eyebrow">下一项</span><p>{next ? `${next.time} · ${next.title}` : "今天的安排已处理，给自己留些休息。"}</p></div></section>
        <section className="plan-next-meal"><div><Utensils size={18} /><h2>{advice.title}</h2></div><p>{advice.food}</p><p className="plan-muted">{advice.reason}</p><button className={button} onClick={props.onRecords}><Camera size={16} />查看实际饮食</button></section>
        <div className="plan-section-heading"><h2>按时间，做眼前这一件</h2><span>{week.days.find((day) => day.date===date)?.focus}</span></div>
        <div className="plan-timeline">{tasks.map((task) => <TaskCard key={task.id} task={task} data={data} disabled={disabled} onEdit={() => setEditing(task)} onComplete={() => setCompleting(task)} onSkip={() => void run(() => props.onUpdate(task,{ status: "skipped" }))} onLater={() => setEditing(task)} onPhoto={(files) => void run(() => props.onPhoto(task,files))} onSwap={() => void run(() => props.onUpdate(task,{ meal_choice: ((data.task_updates?.find((update) => update.id===task.id)?.meal_choice || 0)+1)%task.meals.length,amount: undefined }))} />)}</div>
        <details className="plan-nutrition"><summary>今日营养累计与恢复建议 <ChevronDown size={16} /></summary><NutritionOverview data={data} date={date} /></details>
      </>}
      {view === "week" && <section className="plan-week-table"><div className="plan-section-heading"><h2>一周，不必每天都用力</h2><button className={button} disabled={disabled} onClick={() => { if (window.confirm("按当前个人设置更新未开始的任务？已完成、跳过和手工调整的任务与原有记录会保留。")) void run(() => onGenerate(date,undefined,true)); }}><ArrowRightLeft size={16} />调整本周计划</button></div>{week.days.map((day) => <article className="week-day" key={day.date}><div><h3>{formatChineseDate(day.date)}</h3><p>{day.focus}</p><button className={button} onClick={() => { onDate(day.date); setView("day"); }}>查看当天 <ArrowRight size={14} /></button></div><div>{tasksForDate(data,day.date).map((task) => <p key={task.id}><time>{task.time}</time><span>{task.kind==="meal" ? selectedPlanMeal(data,task)?.portion : `${task.title} · ${task.amount}`}</span><small>{statusLabels[taskState(data,task)]}</small></p>)}</div></article>)}</section>}
      {view === "review" && <section className="plan-review"><h2>先回顾，再安排下一周</h2><dl><div><dt>已确认完成</dt><dd>{review.done} 项</dd></div><div><dt>已跳过</dt><dd>{review.skipped} 项</dd></div><div><dt>实际运动</dt><dd>{review.workouts} 次</dd></div></dl><p>{review.feedback}</p><p className="plan-muted">未记录不代表未进食或未完成。复盘不会自动减少热量目标，不覆盖历史计划。</p><button disabled={disabled} className={`${button} primary`} onClick={() => void run(async () => { const nextDate = addDays(week.week_start,7); if (data.plans?.some((plan) => plan.week_start===nextDate)) { setError("下一周已有计划，未覆盖。请切换至下一周查看或手动调整。"); return; } await onGenerate(nextDate,week.week_start); onDate(nextDate); setView("week"); })}><CalendarDays size={16} />用复盘安排下一周</button><p className="plan-muted">需要长期分析时，由你主动向 ChatGPT 发起，不会自动调用付费模型。</p></section>}
    </>}
    {(error || pending) && <p role="status" className="plan-message">{pending ? <><Loader2 size={16} className="animate-spin" />正在保存</> : error}</p>}
    {editing && <TaskEditor key={editing.id} task={editing} disabled={disabled} onClose={() => setEditing(null)} onSave={(patch) => void run(async () => { await props.onUpdate(editing,patch); setEditing(null); })} />}
    {completing && <CompleteTask key={completing.id} task={completing} data={data} disabled={disabled} onClose={() => setCompleting(null)} onSave={(minutes,ate) => void run(async () => { await props.onComplete(completing,minutes,ate); setCompleting(null); })} />}
  </div>;
}

function TaskCard({ task,data,disabled,onEdit,onComplete,onSkip,onLater,onPhoto,onSwap }: { task: PlanTask;data: AppData;disabled: boolean;onEdit: () => void;onComplete: () => void;onSkip: () => void;onLater: () => void;onPhoto: (files: FileList) => void;onSwap: () => void }) {
  const status = taskState(data,task); const finished = status==="completed";
  const Icon = task.kind==="meal" ? Utensils : task.kind==="exercise" ? Dumbbell : Leaf;
  const input = useRef<HTMLInputElement>(null);
  const choice = selectedPlanMeal(data,task);
  return <article className={`plan-task ${finished ? "is-done" : ""}`} data-task-id={task.id}>
    <div className="task-time"><time>{task.time}</time><Icon size={18} /></div>
    <div className="task-main"><div className="task-title"><h3>{task.title}</h3><span className={`task-status ${status}`}>{statusLabels[status]}</span></div><p className="task-amount">{task.amount}</p><p className="task-duration"><Clock size={14} />约 {task.duration_min} 分钟 <span>· {task.intensity}</span></p>
      {choice?.needs_confirmation && <p role="alert" className="plan-warning">当前食物限制较多，请先确认安全替换食材，不能按此估算记录为已吃。</p>}
      <details className="task-guide"><summary><BookOpen size={15} />怎么做 · 为什么 <ChevronDown size={14} /></summary><p>{task.why}</p><ol>{task.steps.map((step,index) => <li key={index}>{step}</li>)}</ol><p className="task-criteria"><strong>完成标准：</strong>{task.criteria}</p>{choice && !choice.needs_confirmation && !data.task_updates?.find((change) => change.id===task.id)?.amount && <p className="plan-muted">该份量粗估 {choice.calories_min}–{choice.calories_max} kcal；蛋白质 {choice.protein_g}g、脂肪 {choice.fat_g}g、碳水 {choice.carbohydrate_g}g。通用食物参考值，不等于实际摄入或品牌标签。</p>}<div className="task-resources">{task.resources.map((resource) => <a key={resource.url} href={resource.url} target="_blank" rel="noreferrer">{resource.title}<ExternalLink size={13} /></a>)}</div></details>
      <div className="task-actions"><button className={`${button} ${finished ? "" : "primary"}`} disabled={disabled || finished} onClick={onComplete}><Check size={15} />{finished ? "已完成" : "完成"}</button>{task.kind==="meal" && <><button className={button} disabled={disabled} onClick={() => input.current?.click()}><Camera size={15} />拍照记录</button><input ref={input} aria-label={`拍摄${task.title}`} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => { if (event.target.files?.length) onPhoto(event.target.files); event.target.value=""; }} /><button title="换一组食物" aria-label={`替换${task.title}食物`} className={button} disabled={disabled || finished} onClick={onSwap}><ArrowRightLeft size={15} /></button></>}<button title="调整任务" aria-label={`调整${task.title}`} className={button} disabled={disabled || finished} onClick={onEdit}><Pencil size={15} /></button>{!finished && <><button className={button} disabled={disabled} onClick={onLater}><Clock size={15} />稍后</button><button className={button} disabled={disabled} onClick={onSkip}><SkipForward size={15} />跳过</button></>}</div>
    </div>
  </article>;
}

function Modal({ title,children,onClose,disabled }: { title: string;children: React.ReactNode;onClose: () => void;disabled: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  return <dialog ref={(element) => { ref.current=element; if (element && !element.open) element.showModal(); }} onCancel={(event) => { event.preventDefault(); if (!disabled) onClose(); }} className="plan-modal" aria-label={title}><div className="plan-section-heading"><h2>{title}</h2><button className={button} title="关闭" aria-label="关闭任务窗口" disabled={disabled} onClick={onClose}><X size={16} /></button></div>{children}</dialog>;
}
function TaskEditor({ task,disabled,onSave,onClose }: { task: PlanTask;disabled: boolean;onSave: (patch: Partial<TaskUpdate>) => void;onClose: () => void }) {
  const [title,setTitle] = useState(task.title); const [date,setDate] = useState(task.date); const [time,setTime] = useState(task.time); const [amount,setAmount] = useState(task.amount); const [minutes,setMinutes] = useState(task.duration_min); const [note,setNote] = useState("");
  const [recovery,setRecovery] = useState(task.kind==="habit" && task.id.endsWith(":movement"));
  return <Modal title="调整这项计划" disabled={disabled} onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); onSave({ title,scheduled_date: date,scheduled_time: time,...(amount!==task.amount ? { amount } : {}),duration_min: minutes,status: "later",note,recovery }); }}><label>具体行动<input readOnly={task.id.endsWith(":movement")} required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></label><div className="plan-form-grid"><label>执行日期<input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label>执行时间<input required type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label></div><label>份量或操作调整<textarea required maxLength={1000} value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label>预计分钟<input required type="number" min={1} max={90} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} /></label><label>调整原因（可选）<input maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} /></label>{task.id.endsWith(":movement") && <label className="plan-checkbox"><input type="checkbox" checked={recovery} onChange={(event) => setRecovery(event.target.checked)} />今天改为恢复，不做正式训练</label>}<p className="plan-muted">已执行的记录不会随调整改写。身体不适时优先休息，手动份量调整后不要沿用原估算。</p><button type="submit" disabled={disabled} className={`${button} primary`}><Check size={16} />保存调整</button></form></Modal>;
}
function CompleteTask({ task,data,disabled,onClose,onSave }: { task: PlanTask;data: AppData;disabled: boolean;onClose: () => void;onSave: (minutes: number,ate: boolean) => void }) {
  const [minutes,setMinutes] = useState(task.duration_min); const [ate,setAte] = useState(false);
  const meal = selectedPlanMeal(data,task); const custom = data.task_updates?.find((change) => change.id===task.id)?.amount;
  return <Modal title="确认实际完成情况" disabled={disabled} onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); onSave(minutes,ate); }}><h3>{task.title}</h3><p>{task.criteria}</p>{task.kind==="exercise" && <label>实际运动分钟<input type="number" required min={1} max={180} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} /></label>}{task.kind==="meal" && <><p>{task.amount}</p><label className="plan-checkbox"><input type="checkbox" checked={ate} disabled={meal?.needs_confirmation || Boolean(custom)} onChange={(event) => setAte(event.target.checked)} />实际按这份参考菜单用餐，将粗估营养加入记录</label><p className="plan-muted">不勾选时只标记任务，不虚构营养摄入。若吃得不同，拍照或在饮食页记录；修改份量后需自行确认营养。</p></>}<button type="submit" className={`${button} primary`} disabled={disabled}><Check size={16} />确认完成</button></form></Modal>;
}
