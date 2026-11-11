"""批量造声音并成卡，把「声音陈列馆」填满。真实调用百炼，别乱跑。"""
import io
import sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent / "app"))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import dashscope_client as ds
import store

store.init_db()

VOICES = [
    ("老周", "一个五十多岁的东北男人，嗓门大，说话像在跟人吵架，但每句结尾都带着笑。", "ember"),
    ("旧收音机", "一把苍老的女性嗓音，像旧收音机里传出来的，带一点沙沙的电流质感。", "tide"),
    ("深夜三点", "一个二十七八岁的女性，声音很轻，说得很慢，像怕吵醒隔壁房间的人。", "ink"),
    ("阿黄", "一个十七八岁的男孩，声音还没完全变声，说话时句子之间要喘气。", "moss"),
    ("雨里的人", "一个三十多岁的男人，声音被雨声压着，平静、发闷，像已经等了很久。", "tide"),
    ("老会计", "一位六十岁的男性，语速均匀，每个数字都咬得很清楚，不带任何情绪。", "sand"),
    ("纸片人", "一个极其单薄的女声，几乎没有胸腔共鸣，像一张纸被风吹动。", "plum"),
    ("锅炉房", "一个四十多岁的男人，声音沙哑粗粝，像常年待在粉尘很大的地方。", "ember"),
    ("小满", "一个八九岁的女孩，奶声奶气，说每句话结尾都轻轻上扬。", "plum"),
    ("值夜班", "一个疲惫的男性，声音平淡无起伏，说到一半会停下来叹气。", "ink"),
    ("卖鱼佬", "一个五十岁的男性，嗓门洪亮，带明显南方口音，句尾习惯性拖长。", "moss"),
    ("断线", "一个电子合成音，女性，没有情绪起伏，每个字都精确等距。", "ink"),
    ("老烟嗓", "一个七十岁的老人，声音干枯，一句话中间要换两次气。", "sand"),
    ("主持人", "一个三十岁的男性播音员，音色低沉有磁性，语速平稳。", "ember"),
    ("隔壁" , "一个年轻女性，声音低而近，气声很多，像贴着耳朵说话。", "plum"),
    ("跑上楼", "一个二十岁的男性，说话断续，带明显喘息，但很兴奋。", "moss"),
    ("老教授", "一位七十岁的男性学者，语速慢，字与字之间留出思考的空隙。", "sand"),
    ("推销员", "一个浮夸的男性，语速极快，每个数字都重读，句尾上扬。", "ember"),
    ("空房间", "一个女性声音，尾音很长，像在很大的空房间里说话，带回声感。", "tide"),
    ("小丑", "一个刻意压低的男性声音，带着不合时宜的笑意，像在忍着什么。", "plum"),
    ("雾", "一个模糊的、几乎没有起伏的女声，像从很远的地方传来。", "ink"),
    ("老式电话", "一个经过电话带宽限制的男性声音，干瘪、发闷、高频缺失。", "sand"),
    ("猫", "一个刻意装可爱的高音女声，每个词都用同一种上扬语调。", "plum"),
    ("车站广播", "一个标准的女性广播音，字正腔圆，语速略慢，尾音下沉。", "tide"),
    ("吵架", "一个四十岁的女性，语速极快，音量很大，情绪明显激动。", "ember"),
    ("困", "一个二十多岁的男性，声音含糊，像刚被叫醒还没完全清醒。", "moss"),
    ("旧电影", "一个老派男性配音腔，共鸣很重，像上世纪译制片里的旁白。", "sand"),
    ("哭过", "一个年轻女性，声音里带着鼻音，像刚哭完又努力平静下来。", "ink"),
    ("班主任", "一位五十岁的女性，语速偏快，语气笃定，句末习惯性加重。", "moss"),
    ("海风", "一个中年男性，声音被风吃掉一部分，听得清但不清楚。", "tide"),
    ("打字机", "一个节奏感极强的男声，每个字之间停顿相同，像机器在敲。", "ink"),
    ("糖", "一个甜而黏的女声，语速慢，气声多，每句话都像在哄人。", "plum"),
    ("老屋", "一个苍老的男性嗓音，干、慢、稳，像从旧木箱里取东西。", "sand"),
    ("报站", "一个中性声音，每个字都很短促，句与句之间留白明显。", "tide"),
    ("深夜电台", "一个三十多岁的女性，声音温润，语速很慢，尾音轻轻落下。", "plum"),
    ("坏掉", "一个会突然卡顿的机械合成音，音高不稳，像信号在衰减。", "ink"),
    ("少年", "一个十五岁的男孩，声音清亮，语速偏快，带一点紧张。", "moss"),
    ("老猎人", "一位六十多岁的男性，声音低哑，说话很省字，句尾往下压。", "sand"),
    ("醉", "一个喝醉了的男性，声音含糊，忽大忽小，随时会笑起来。", "ember"),
    ("电台主持人二代", "一个二十八岁的男性，声音明亮，语速偏快，句尾常带笑意。", "ember"),
    ("录音棚", "一个专业女性配音，共鸣饱满，咬字清晰，不带口音。", "tide"),
    ("小卖部", "一个中年女性，带点地方口音，语速快，句尾习惯性上扬。", "moss"),
    ("老电视机", "一个窄频带的男声，闷、糊，像从很小的扬声器里出来。", "ink"),
    ("怕吵醒谁", "一位声音沙哑的中年女性，说话很轻，但每个尾音都不肯落下去。", "plum"),
    ("讲故事", "一位七十岁的老先生，声音干枯但稳，说话很慢。", "sand"),
    ("凌晨四点", "一个极度疲惫的男声，音量很小，句子之间停顿很长。", "ink"),
    ("纸风车", "一个轻快的年轻女声，语速快，情绪上扬，像在分享好消息。", "moss"),
]

PREVIEW = "你好，我是刚刚被造出来的声音。你听，这就是我。"


def one(idx_item):
    idx, (name, prompt, accent) = idx_item
    try:
        got = ds.design_voice(prompt, PREVIEW, f"seed{idx:02d}")
        did = store.save_draft(prompt, got["voice_id"], got["preview_bytes"])
        d = store.get_draft(did)
        cid = store.create_card(name, prompt, got["voice_id"], d["preview_file"], accent)
        store.mark_draft_used(did)
        return (idx, name, cid, got["elapsed_ms"], None)
    except Exception as e:  # noqa: BLE001
        return (idx, name, None, 0, str(e)[:120])


if __name__ == "__main__":
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    end = int(sys.argv[2]) if len(sys.argv) > 2 else len(VOICES)
    items = list(enumerate(VOICES))[start:end]
    ok = fail = 0
    with ThreadPoolExecutor(max_workers=3) as ex:
        for idx, name, cid, ms, err in ex.map(one, items):
            if cid:
                ok += 1
                print(f"[{idx:02d}] {name:<14} card={cid} {ms}ms")
            else:
                fail += 1
                print(f"[{idx:02d}] {name:<14} FAILED {err}")
    print(f"\n完成 {ok} 张，失败 {fail} 张，库里共 {store.card_count()} 张卡")
