import { useState } from "react";
import { ShieldCheck } from "lucide-react";

interface AetherTermsModalProps {
  onAccept: () => void;
}

export default function AetherTermsModal({ onAccept }: AetherTermsModalProps) {
  const [confirmed, setConfirmed] = useState(false);

  return (
    <div className="aether-terms-overlay fixed inset-0 z-[12000] flex items-center justify-center bg-black/90 p-4 backdrop-blur-md">
      <div className="aether-terms-panel flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-[#0a0d12] text-slate-100 shadow-2xl">
        <div className="border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2 text-base font-bold tracking-wide">
            <ShieldCheck className="h-5 w-5 text-cyan-400" />
            AETHER 免责条款与使用条款
          </div>
          <div className="mt-1 text-[11px] text-slate-500">首次使用前请完整阅读。接受后本版本不再重复弹出。</div>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4 text-sm leading-7 text-slate-300">
          <section>
            <h2 className="font-bold text-white">一、模拟性质与免责声明</h2>
            <p>AETHER 是台风模拟与气象可视化软件。软件中的台风路径、强度、降水、风圈、气象站数据、预警、灾情、机场/交通状态、经济损失等内容均为模型模拟结果，不代表现实观测、官方预报或正在生效的气象灾害预警。</p>
            <p>模拟结果可能受模型简化、初始条件、随机过程、数据分辨率及程序误差影响。不得将本软件输出作为防灾避险、航海航空、工程调度、保险理赔、投资交易或其他现实安全关键决策的唯一依据。现实天气与灾害信息请以所在地官方气象、应急管理及政府部门发布为准。</p>
          </section>

          <section>
            <h2 className="font-bold text-white">二、授权与禁止行为</h2>
            <p><strong className="text-red-400">禁止倒卖程序。</strong>在未获得开发者书面授权的情况下，禁止转售、付费分发、冒充作者销售本程序或其修改版本；不得通过去除署名、误导性包装等方式使他人误认为获得了官方或商业授权。</p>
            <p><strong className="text-red-400">禁止用于非法用途。</strong>禁止将本程序用于违法、欺诈、威胁公共安全、散布虚假灾情/虚假预警、冒充政府或气象机构、破坏计算机系统或侵犯他人合法权益的活动。</p>
            <p>不得故意删除或遮挡程序自动加入的“模拟”“SIMULATION ONLY”“非现实生效公告”等风险提示后，再将生成内容作为真实气象产品传播。</p>
          </section>

          <section>
            <h2 className="font-bold text-white">三、内容与第三方资料</h2>
            <p>软件可能使用公开地理、地图或气象规则资料进行模拟和可视化。第三方数据、地图及相关标识的权利归各自权利人所有。AETHER 生成的仿业务图件仅用于模拟展示，不代表相应机构制作、审核或背书。</p>
          </section>

          <section>
            <h2 className="font-bold text-white">四、风险承担</h2>
            <p>用户应自行判断模拟结果的适用范围，并对使用、保存、分享或二次处理模拟结果产生的后果负责。因将模拟内容误用为现实信息或违反本条款所造成的损失与法律责任，由相应使用者承担。</p>
          </section>

          <section>
            <h2 className="font-bold text-white">五、条款接受</h2>
            <p>继续进入程序表示你已阅读、理解并同意以上免责条款与使用条款。若不同意，请停止使用本程序。</p>
          </section>
        </div>

        <div className="border-t border-slate-800 bg-slate-950/70 px-5 py-4">
          <label className="flex cursor-pointer items-start gap-3 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-cyan-500"
            />
            <span>我已阅读并同意上述免责条款与使用条款，并知悉本软件全部气象与灾害内容均为模拟。</span>
          </label>
          <button
            type="button"
            disabled={!confirmed}
            onClick={onAccept}
            className="mt-4 w-full rounded-xl bg-cyan-500 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
          >
            同意并进入 AETHER
          </button>
        </div>
      </div>
    </div>
  );
}
