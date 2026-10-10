import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async({page})=>{
  page.on("request",request=>{
    const url=new URL(request.url());
    if(url.hostname!=="127.0.0.1"&&url.hostname!=="hosted.invalid")throw new Error("Unexpected external request: "+url.origin);
    if(!["GET","HEAD"].includes(request.method()))throw new Error("Mock walkthrough must not issue HTTP mutations");
  });
});

test("local interactive mock journey preserves identity, gates and recorded reconciliation", async ({page})=>{
  const effects:string[]=[];
  page.on("request",r=>{if(!["GET","HEAD"].includes(r.method())||new URL(r.url()).hostname!=="127.0.0.1")effects.push(r.method()+" "+r.url());});
  await page.goto("/local-demo");
  await expect(page.getByRole("heading",{name:"Local synthetic walkthrough"})).toBeVisible();
  await expect(page.getByTestId("synthetic-notice")).toContainText("SIMULATED / NON-ECONOMIC / NOT_VENDOR_PAYMENT");
  await expect(page.getByTestId("journey-stage")).toHaveText("OBLIGATION");
  await page.getByRole("button",{name:"Assess mock case",exact:true}).click();
  await expect(page.getByTestId("advisory")).toContainText("PAY");
  await page.getByRole("button",{name:"Mock case B"}).click();
  await expect(page.getByTestId("journey-stage")).toHaveText("OBLIGATION");
  await page.getByRole("button",{name:"Mock case A"}).click();
  await page.getByRole("button",{name:"Acknowledge exact mock intent"}).click();
  await expect(page.getByTestId("mock-packet")).toContainText("MOCK_REVIEWER");
  await expect(page.getByTestId("mock-packet")).toContainText("Unsigned");
  await page.getByRole("button",{name:"Submit to fake adapter",exact:true}).click();
  await expect(page.getByTestId("journey-stage")).toHaveText("SUBMITTED_MOCK");
  await expect(page.getByText("Fake submissions: 1",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Observe recorded fake outcome"}).click();
  await expect(page.getByTestId("journey-stage")).toHaveText("RECONCILED_MOCK");
  await expect(page.getByTestId("mock-audit")).toContainText("RECONCILED_MOCK");
  expect(effects).toEqual([]);
});

test("mock scenario interactions enforce holds, stale inputs, packet binding and UNKNOWN no retry",async({page})=>{
  await page.goto("/local-demo");
  for(const scenario of ["HOLD","ESCALATE","FUNDING_HOLD"]){
    await page.getByLabel("Mock scenario").selectOption(scenario);
    await page.getByRole("button",{name:"Assess mock case",exact:true}).click();
    await expect(page.getByRole("button",{name:"Acknowledge exact mock intent"})).toBeDisabled();
    await expect(page.getByText("Fake submissions: 0",{exact:true})).toBeVisible();
  }
  await page.getByLabel("Mock scenario").selectOption("PAY");
  await page.getByRole("button",{name:"Assess mock case",exact:true}).click();
  await page.getByRole("button",{name:"Change mock amount"}).click();
  await expect(page.getByTestId("advisory")).toContainText("No current assessment");
  for(const scenario of ["HISTORICAL_AUTHORITY","PACKET_MISMATCH","DESTINATION_CHANGED"]){
    await page.getByLabel("Mock scenario").selectOption(scenario);
    await page.getByRole("button",{name:"Assess mock case",exact:true}).click();
    await page.getByRole("button",{name:"Acknowledge exact mock intent"}).click();
    if(scenario==="DESTINATION_CHANGED")await page.getByRole("button",{name:"Change mock destination"}).click();
    await page.getByRole("button",{name:"Submit to fake adapter",exact:true}).click();
    await expect(page.locator("main").getByRole("alert")).toContainText("BLOCKED");
    await expect(page.getByText("Fake submissions: 0",{exact:true})).toBeVisible();
  }
  await page.getByLabel("Mock scenario").selectOption("UNKNOWN");
  await page.getByRole("button",{name:"Assess mock case",exact:true}).click();
  await page.getByRole("button",{name:"Acknowledge exact mock intent"}).click();
  await page.getByRole("button",{name:"Submit to fake adapter",exact:true}).click();
  await expect(page.getByTestId("journey-stage")).toHaveText("UNKNOWN");
  await expect(page.getByTestId("next-action")).toContainText("OUTCOME_UNVERIFIED / NO RETRY");
  await expect(page.getByRole("button",{name:"Submit to fake adapter",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"Observe recorded fake outcome"}).click();
  await expect(page.getByTestId("journey-stage")).toHaveText("UNKNOWN");
  await expect(page.getByText("Fake submissions: 1",{exact:true})).toBeVisible();
});

for(const viewport of [{width:1365,height:951},{width:390,height:844},{width:320,height:640}]){
  test(`local walkthrough accessibility and viewport ${viewport.width}`,async({page})=>{
    await page.setViewportSize(viewport);await page.goto("/local-demo");
    await expect(page.getByRole("button",{name:"Assess mock case",exact:true})).toBeVisible();
    if(viewport.width===320)await page.evaluate(()=>{document.documentElement.style.fontSize="200%";});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
    await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
    await expect(page.getByRole("region",{name:"Current mock next action"})).toBeInViewport();
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:test.info().outputPath(`local-mock-${viewport.width}.png`),fullPage:true});
  });
}

test("hosted and embedded activation is rejected without a mock journey",async({page})=>{
  await page.route("http://hosted.invalid/**",async route=>{
    const url=new URL(route.request().url());
    const response=await page.request.get(`http://127.0.0.1:3190${url.pathname}${url.search}`);
    await route.fulfill({response});
  });
  await page.goto("http://hosted.invalid/local-demo");
  await expect(page.locator("main").getByRole("alert")).toContainText("LOCAL_ONLY");
  await expect(page.getByRole("button",{name:"Assess mock case",exact:true})).toHaveCount(0);
  await page.goto("/");
  await page.evaluate(()=>{const f=document.createElement("iframe");f.src="/local-demo";f.title="embedded demo";document.body.append(f);});
  await expect(page.frameLocator('iframe[title="embedded demo"]').locator("main").getByRole("alert")).toContainText("LOCAL_ONLY");
});


test("adversarial request shape and genuine mutation denials remain isolated",async({request})=>{
  const hostileHeaders:Record<string,string>[]=[{"x-forwarded-for":"203.0.113.4"},{"x-forwarded-host":"evil.test"},{origin:"https://evil.test"},{forwarded:"for=127.0.0.1"}];
  for(const headers of hostileHeaders) {
    const response=await request.get("/local-demo",{headers});expect(await response.text()).toContain("LOCAL_ONLY");
    expect(await response.text()).not.toContain("Assess mock case</button>");
  }
  const list=await request.get("/api/obligations");expect((await list.json()).obligations).toEqual([]);
  for(const route of ["approve","kill-switch"]){
    const response=await request.post(`/api/obligations/OBL-J0C-001/${route}`,{data:{actor_id:"MOCK_REVIEWER",action:"DEACTIVATE"}});
    expect(response.status()).toBe(403);expect((await response.json()).code).toBe("REQUESTER_UNVERIFIED");
  }
});
