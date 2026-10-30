import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetAdminEmailHealth, getGetAdminEmailHealthQueryKey, useSendAdminEmailTest, useRetryAdminLeadEmails,
} from '@workspace/api-client-react';
import { SectionHeading, formatAdminDate } from './AdminShared';

function errorText(error: unknown) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data as {error?:string};
    if (data?.error) return data.error;
  }
  return error instanceof Error ? error.message : 'Request failed. Nothing else was automatically sent.';
}

export default function EmailHealthSection() {
  const queryClient=useQueryClient();
  const {data,isLoading,isError,refetch}=useGetAdminEmailHealth({query:{queryKey:getGetAdminEmailHealthQueryKey(),retry:false,refetchInterval:30_000}});
  const test=useSendAdminEmailTest({mutation:{retry:false}});
  const retry=useRetryAdminLeadEmails({mutation:{retry:false}});
  const [selected,setSelected]=useState<number[]>([]);
  const [review,setReview]=useState<Array<{id:number;recipient:string}>|null>(null);
  const [result,setResult]=useState('');
  const [busy,setBusy]=useState(false);
  const refresh=()=>queryClient.invalidateQueries({queryKey:getGetAdminEmailHealthQueryKey()});
  const choices=(data?.failed ?? []).filter(row=>selected.includes(row.id)&&row.recipient);
  async function sendTest() {
    setBusy(true);setResult('');
    try {
      const response=await test.mutateAsync({data:{requestId:crypto.randomUUID()}});
      setResult(response.success?'Test email sent to your own verified admin email address.':
        `${response.cause} ${response.error ?? ''} ${response.hint}`);
      await refresh();
    }catch(error){setResult(errorText(error));}finally{setBusy(false);}
  }
  async function confirmBatch() {
    if(!review?.length)return;
    setBusy(true);setResult('');
    try {
      const response=await retry.mutateAsync({data:{confirmed:true,entries:review}});
      setResult(`${response.queued} email(s) queued for retry. Unselected messages were not queued. Records that changed since review were skipped.`);
      setReview(null);setSelected([]);await refresh();
    }catch(error){setResult(errorText(error));}finally{setBusy(false);}
  }
  const button="admin-link min-h-10 rounded-xl border border-[#d5dfd5] px-3 py-2 text-xs font-bold disabled:opacity-50";
  return <section className="mt-8 mb-8" aria-label="Email health">
    <SectionHeading eyebrow="Reliability" title="Email health" detail="Lead notifications and admin test sends. No old failures are automatically resent." />
    {isLoading?<p>Loading email health…</p>:isError||!data?<div role="alert">Email health is unavailable. <button className={button} onClick={()=>void refetch()}>Refresh</button></div>:<>
      <div className="admin-panel grid gap-4 rounded-2xl p-4 sm:grid-cols-2 sm:p-6">
        <div><h3 className="font-bold">Last successful send</h3>
          {data.lastSuccess?<><p>{formatAdminDate(data.lastSuccess.at)}</p>{!data.lastSuccess.timestampExact&&<p className="text-xs">Historical record creation time; the exact send time was not stored.</p>}</>:<p>No successful sends recorded.</p>}
        </div>
        <div><h3 className="font-bold">Last failure</h3>
          {data.lastFailure?<><p>{data.lastFailure.cause}</p><p className="text-sm">{data.lastFailure.hint}</p>
            <p className="mt-2 break-words text-xs">{data.lastFailure.error}</p><p className="text-xs">{formatAdminDate(data.lastFailure.at)}{!data.lastFailure.timestampExact?' · Historical record time, not exact failure time':''}</p></>:<p>No failures recorded.</p>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-3"><button className={button} disabled={busy||Boolean(review)} onClick={()=>void sendTest()}>Send test email to me</button>
        <p className="self-center text-xs">One message to your signed-in admin account only. No client recipients.</p></div>
      <h3 className="mt-6 font-bold">Retry failed emails</h3>
      <p className="mb-3 text-sm">Nothing is selected by default. Review recipients and message age before confirming each batch (maximum 50).</p>
      {!data.failed.length?<p>No failed lead emails.</p>:<div className="admin-panel max-h-96 overflow-auto rounded-xl">
        {data.failed.map(row=><label key={row.id} className="flex items-start gap-3 border-b p-3">
          <input type="checkbox" checked={selected.includes(row.id)} disabled={busy||Boolean(review)||!row.recipient||(selected.length>=50&&!selected.includes(row.id))}
            onChange={event=>setSelected(current=>event.target.checked?[...current,row.id]:current.filter(id=>id!==row.id))} aria-label={`Select failed email ${row.id}`} />
          <span className="min-w-0 break-words text-sm"><strong>#{row.id} · {row.recipient ?? 'No recipient configured'}</strong>
            <span className="block text-xs">Age: {Math.max(0,Math.floor((Date.now()-Date.parse(row.createdAt))/86_400_000))} days · {formatAdminDate(row.createdAt)}</span>
            <span className="block text-xs">{row.cause}</span></span>
        </label>)}
      </div>}
      {data.hasMore&&<p className="text-xs">Showing the oldest 100 failures. Refresh after a batch to view later records.</p>}
      <button className={`${button} mt-3`} disabled={busy||!choices.length||Boolean(review)} onClick={()=>setReview(choices.map(row=>({id:row.id,recipient:row.recipient!})))}>Review retry batch ({choices.length})</button>
      {review&&<div role="dialog" aria-modal="false" aria-label="Confirm email retry batch" className="admin-panel mt-4 rounded-xl border-2 p-4">
        <h4 className="font-bold">Confirm retry of {review.length} failed email(s)</h4>
        <p className="text-sm">These are real lead notifications. Confirming will queue messages to the following recipients:</p>
        <ul className="my-3 text-sm">{review.map(row=><li key={row.id}>#{row.id} · {row.recipient}</li>)}</ul>
        <button className={button} disabled={busy} onClick={()=>setReview(null)}>Cancel — send nothing</button>{' '}
        <button className={button} disabled={busy} onClick={()=>void confirmBatch()}>Confirm and queue {review.length} email(s)</button>
      </div>}
    </>}
    {result&&<p role="status" className="admin-panel mt-4 break-words rounded-xl p-4 text-sm">{result}</p>}
  </section>;
}
