import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_KEY = Deno.env.get("RESEND_API_KEY")!;
const SB_URL = Deno.env.get("SB_URL")!;
const SB_KEY = Deno.env.get("SB_SERVICE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email } = await req.json();
    if (!email) throw new Error("请填写邮箱地址");

    const supabase = createClient(SB_URL, SB_KEY);

    // 1. 查找未使用的激活码
    const { data: codes, error: qe } = await supabase
      .from("schulte_codes")
      .select("*")
      .lt("use_count", 2)
      .limit(1);

    if (qe || !codes || codes.length === 0) {
      throw new Error("暂无可用激活码，请联系管理员");
    }

    const row = codes[0];
    const newCount = (row.use_count || 0) + 1;

    // 2. 发送邮件
    const emailResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_KEY}`,
      },
      body: JSON.stringify({
        from: "舒尔特方格 <code@mail.yegodd.me>",
        to: [email],
        subject: "🎮 您的舒尔特方格激活码",
        html: `
<div style="font-family:'PingFang SC','Microsoft YaHei',sans-serif;max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
  <div style="background:linear-gradient(135deg,#6a5acd,#8b7ae8);padding:32px 20px;text-align:center;">
    <h2 style="color:#fff;margin:0;font-size:22px;">🔓 舒尔特方格 · 激活码</h2>
    <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:14px;">感谢您的购买，祝训练愉快！</p>
  </div>
  <div style="padding:28px 24px;">
    <div style="background:#f6f4ff;border:2px dashed #6a5acd;border-radius:12px;padding:24px;text-align:center;margin-bottom:20px;">
      <span style="font-size:30px;font-weight:bold;color:#6a5acd;letter-spacing:4px;font-family:monospace;">${row.code}</span>
    </div>
    <p style="color:#444;line-height:1.8;font-size:14px;">
      📍 <b>激活方式</b>：打开<br>
      <a href="https://yegodd.github.io/schulte-grid/" style="color:#6a5acd;">https://yegodd.github.io/schulte-grid/</a><br>
      → 点击任意 🔒 按钮 → 输入上方激活码
    </p>
    <p style="color:#999;font-size:12px;margin-top:16px;">
      💡 一个激活码可绑定 <b>2 台设备</b>（手机+电脑均可用）
    </p>
  </div>
</div>`,
      }),
    });

    if (!emailResp.ok) {
      const errBody = await emailResp.text();
      console.error("Resend error:", errBody);
      throw new Error("邮件发送失败，请稍后重试");
    }

    // 3. 更新码的使用次数
    const updateBody: Record<string, unknown> = {
      use_count: newCount,
      used_at: new Date().toISOString(),
    };
    if (newCount >= 2) updateBody.is_used = true;

    await supabase.from("schulte_codes").update(updateBody).eq("code", row.code);

    // 4. 记录订单
    await supabase.from("schulte_orders").insert({
      email,
      code: row.code,
      created_at: new Date().toISOString(),
    });

    return new Response(
      JSON.stringify({ success: true, message: "✅ 激活码已发送，请查收邮箱" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "服务器错误";
    console.error(msg);
    return new Response(
      JSON.stringify({ success: false, message: msg }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
